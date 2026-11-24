-- Manual final fixture confirmation: an authorized organiser may override
-- participant availability while retaining strict calendar/bracket safety.
-- The existing match-event publication trigger creates targeted player notices.
create or replace function public.admin_force_publish_manual_final(
  target_tournament_id uuid,
  target_series_id uuid,
  target_round_number integer,
  target_display_order integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  selected_club uuid := public.admin_current_club_id();
  chosen_tournament public.tournaments;
  chosen_match public.tournament_matches;
  chosen_plan public.tournament_match_planning;
  chosen_resource public.reservable_resources;
  chosen_series public.tournament_series;
  tournament_event_type_id uuid;
  published_event_id uuid;
  starts_at_utc timestamptz;
  ends_at_utc timestamptz;
  notification_count integer;
begin
  if auth.uid() is null or selected_club is null
    or not public.has_club_permission(selected_club,'tournaments.manage') then
    raise exception 'Forbidden' using errcode='42501';
  end if;

  select * into chosen_tournament from public.tournaments
  where id=target_tournament_id and club_id=selected_club for update;
  if chosen_tournament.id is null then
    raise exception 'Tournoi introuvable dans ce club' using errcode='P0002';
  end if;

  select * into chosen_series from public.tournament_series
  where id=target_series_id and tournament_id=target_tournament_id and enabled;
  if chosen_series.id is null then
    raise exception 'Série introuvable' using errcode='P0002';
  end if;

  select * into chosen_match from public.tournament_matches
  where tournament_id=target_tournament_id
    and series_id=target_series_id and phase='finals'
    and final_round_number=target_round_number
    and display_order=target_display_order
  for update;
  if chosen_match.id is null or chosen_match.team_a_id is null
     or chosen_match.team_b_id is null
     or chosen_match.team_a_id=chosen_match.team_b_id
     or exists (select 1 from public.tournament_match_results
                where match_id=chosen_match.id and status='validated') then
    raise exception 'Rencontre incomplète ou terminée' using errcode='P0001';
  end if;

  if exists(select 1 from public.tournament_match_events
            where match_id=chosen_match.id) then
    select count(*) into notification_count
    from public.communication_deliveries d
    join public.tournament_match_reminder_events n on n.communication_id=d.communication_id
    where n.match_id=chosen_match.id and n.reminder_kind='final_round_published';
    return jsonb_build_object('published',true,'alreadyPublished',true,
                              'matchId',chosen_match.id,'recipientCount',notification_count);
  end if;

  select * into chosen_plan from public.tournament_match_planning
  where match_id=chosen_match.id for update;
  if chosen_plan.match_id is null or chosen_plan.resource_id is null
     or chosen_plan.source is distinct from 'manual' then
    raise exception 'Rencontre non préprogrammée manuellement' using errcode='P0001';
  end if;
  select * into chosen_resource from public.reservable_resources
  where id=chosen_plan.resource_id and club_id=selected_club;
  if chosen_resource.id is null or not exists(
      select 1 from public.tournament_resources
      where tournament_id=target_tournament_id and resource_id=chosen_resource.id
    ) then
    raise exception 'Terrain non autorisé pour le tournoi' using errcode='P0001';
  end if;

  starts_at_utc:=public.tournament_planning_starts_at(
    chosen_plan.play_date,chosen_plan.starts_at,chosen_resource.timezone);
  ends_at_utc:=public.tournament_planning_starts_at(
    chosen_plan.play_date,chosen_plan.ends_at,chosen_resource.timezone);
  if starts_at_utc<=now() or ends_at_utc<=starts_at_utc then
    raise exception 'Horaire de rencontre invalide ou passé' using errcode='P0001';
  end if;

  -- Real occupation always wins, even under an administrator exception.
  if exists(select 1 from public.calendar_occupations occupied
     where occupied.resource_id=chosen_resource.id
       and occupied.cancelled_at is null
       and occupied.starts_at<ends_at_utc
       and occupied.ends_at>starts_at_utc) then
    raise exception 'Créneau déjà occupé dans le calendrier' using errcode='23P01';
  end if;
  if exists(select 1
     from public.tournament_match_planning other
     where other.match_id<>chosen_match.id
       and other.resource_id=chosen_resource.id
       and other.play_date=chosen_plan.play_date
       and other.starts_at<chosen_plan.ends_at
       and other.ends_at>chosen_plan.starts_at
       and exists(select 1 from public.tournament_matches other_match
           where other_match.id=other.match_id
             and other_match.team_a_id is not null
             and other_match.team_b_id is not null
             and not exists(select 1 from public.tournament_match_results done
               where done.match_id=other_match.id and done.status='validated'))) then
    raise exception 'Créneau déjà affecté à une autre rencontre' using errcode='23P01';
  end if;

  -- Respect the actual dependencies, not global stage date ranges.
  if exists(
    select 1 from public.tournament_final_planning_nodes previous_node
    where previous_node.tournament_id=target_tournament_id
      and previous_node.series_id=target_series_id
      and previous_node.round_number<target_round_number
      and public.tournament_final_node_depends_on(
        target_series_id,target_round_number,target_display_order,
        previous_node.round_number,previous_node.display_order)
      and (previous_node.resource_id is null
           or (previous_node.play_date+previous_node.ends_at)>
              (chosen_plan.play_date+chosen_plan.starts_at))
  ) or exists(
    select 1 from public.tournament_final_planning_nodes following_node
    where following_node.tournament_id=target_tournament_id
      and following_node.series_id=target_series_id
      and following_node.round_number>target_round_number
      and following_node.resource_id is not null
      and public.tournament_final_node_depends_on(
        target_series_id,following_node.round_number,following_node.display_order,
        target_round_number,target_display_order)
      and (following_node.play_date+following_node.starts_at)<
          (chosen_plan.play_date+chosen_plan.ends_at)
  ) then
    raise exception 'Ordre sportif des rencontres non respecté' using errcode='P0001';
  end if;

  select id into tournament_event_type_id from public.event_types
  where club_id=selected_club and lower(name)=lower('Tournoi')
  order by display_order,id limit 1;
  if tournament_event_type_id is null then
    insert into public.event_types(club_id,name,color,icon,display_order)
    values(selected_club,'Tournoi','#DC2626','trophy',10)
    returning id into tournament_event_type_id;
  end if;

  insert into public.events(
    club_id,event_type_id,name,description,color,
    starts_at,ends_at,is_blocking,visibility,publication_status,
    registration_required,created_by,updated_by
  ) values (
    selected_club,tournament_event_type_id,
    concat(chosen_series.name,' · ',
      public.tournament_team_public_label(chosen_match.team_a_id),
      ' — ',public.tournament_team_public_label(chosen_match.team_b_id)),
    concat(chosen_tournament.name,' · Phase finale · ',chosen_match.final_round),
    chosen_series.color,starts_at_utc,ends_at_utc,true,'public','published',
    false,auth.uid(),auth.uid()
  ) returning id into published_event_id;

  insert into public.event_resources(event_id,resource_id)
  values(published_event_id,chosen_resource.id);
  -- The existing AFTER INSERT trigger creates per-team communications and
  -- push delivery attempts using the established deduplication keys.
  insert into public.tournament_match_events(match_id,event_id)
  values(chosen_match.id,published_event_id);
  perform public.sync_event_occupations(published_event_id);

  insert into public.tournament_audit_log(
    tournament_id,action,before_status,after_status,payload,created_by)
  values(target_tournament_id,'manual_final_force_published',
    chosen_tournament.status,chosen_tournament.status,
    jsonb_build_object('match_id',chosen_match.id,'event_id',published_event_id,
      'override','participant_availability','play_date',chosen_plan.play_date,
      'starts_at',chosen_plan.starts_at),auth.uid());

  select count(*) into notification_count
  from public.communication_deliveries d
  join public.tournament_match_reminder_events n on n.communication_id=d.communication_id
  where n.match_id=chosen_match.id and n.reminder_kind='final_round_published';

  return jsonb_build_object('published',true,'alreadyPublished',false,
    'matchId',chosen_match.id,'recipientCount',notification_count);
end;
$function$;

revoke all on function public.admin_force_publish_manual_final(uuid,uuid,integer,integer)
from public,anon,authenticated;
grant execute on function public.admin_force_publish_manual_final(uuid,uuid,integer,integer)
to authenticated;
