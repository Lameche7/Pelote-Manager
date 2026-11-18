-- Allow organizers to set a final-day running order before finalists are known,
-- and adjust it atomically (including published fixtures) until kickoff.
begin;

create or replace function public.admin_save_tournament_final_day_lineup(
  target_tournament_id uuid, payload jsonb
)
returns integer
language plpgsql security definer set search_path = ''
as $function$
declare
  selected_club uuid := public.admin_current_club_id();
  chosen public.tournaments;
  entry record;
  clash record;
  current_match public.tournament_matches;
  current_plan public.tournament_match_planning;
  current_event uuid;
  tz text;
  start_instant timestamptz;
  end_instant timestamptz;
  changes integer := 0;
  series_to_publish uuid;
  affected_series_ids uuid[] := array[]::uuid[];
begin
  if auth.uid() is null or selected_club is null
    or not public.has_club_permission(selected_club, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'array'
    or jsonb_array_length(payload) = 0 or jsonb_array_length(payload) > 30 then
    raise exception 'Provide 1 to 30 finals' using errcode='22023';
  end if;

  select * into chosen from public.tournaments
  where id=target_tournament_id and club_id=selected_club for update;
  if not found or chosen.finals_ends_on is null then
    raise exception 'Tournament or finals day missing' using errcode='P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext(target_tournament_id::text), 170012);
  set constraints public.tournament_match_planning_tournament_id_resource_id_play_da_key deferred;

  -- Prevalidate every changed final before touching any calendar occupation.
  if exists (
    select 1
    from jsonb_to_recordset(payload) as x(series_id uuid,resource_id uuid,starts_at time,ends_at time)
    group by x.series_id having count(*) > 1
  ) then raise exception 'Duplicate final series' using errcode='22023'; end if;

  for entry in
    select x.series_id, x.resource_id, x.starts_at, x.ends_at,
           n.round_number, n.display_order,
           r.timezone,
           (chosen.finals_ends_on + x.starts_at) at time zone r.timezone as start_at,
           (chosen.finals_ends_on + x.ends_at) at time zone r.timezone as end_at
    from jsonb_to_recordset(payload) as x(series_id uuid,resource_id uuid,starts_at time,ends_at time)
    join public.tournament_final_planning_nodes n
      on n.tournament_id=target_tournament_id and n.series_id=x.series_id
      and n.round='final'
    join public.reservable_resources r
      on r.id=x.resource_id and r.club_id=selected_club and r.is_active
    join public.tournament_resources tr
      on tr.tournament_id=target_tournament_id and tr.resource_id=r.id
  loop
    if entry.starts_at is null or entry.ends_at is null
      or entry.ends_at<=entry.starts_at
      or entry.ends_at-entry.starts_at<interval '30 minutes'
      or entry.ends_at-entry.starts_at>interval '5 hours'
      or entry.start_at<=now() then
      raise exception 'Invalid or already started final slot' using errcode='22023';
    end if;

    if exists (
      select 1 from public.tournament_matches m
      left join public.tournament_match_results result on result.match_id=m.id
      where m.tournament_id=target_tournament_id and m.series_id=entry.series_id
        and m.phase='finals' and m.final_round='final'
        and (result.status='validated' or m.status='played')
    ) then raise exception 'A finished final cannot be moved' using errcode='P0001'; end if;
    changes:=changes+1;
  end loop;

  if changes<>jsonb_array_length(payload) then
    raise exception 'Every requested series must have a final and a valid club court' using errcode='22023';
  end if;

  -- Overlaps inside the proposed lineup.
  if exists (
    with slots as (
      select x.series_id,x.resource_id,x.starts_at,x.ends_at
      from jsonb_to_recordset(payload) as x(series_id uuid,resource_id uuid,starts_at time,ends_at time)
    )
    select 1 from slots a join slots b
      on a.series_id<b.series_id and a.resource_id=b.resource_id
      and a.starts_at<b.ends_at and a.ends_at>b.starts_at
  ) then raise exception 'Finals overlap on the same court' using errcode='23P01'; end if;

  -- Respect every other bracket position, competition match and reservation
  -- except the finals being atomically reordered in this transaction.
  for entry in
    select x.series_id,x.resource_id,x.starts_at,x.ends_at,r.timezone,
      (chosen.finals_ends_on+x.starts_at) at time zone r.timezone as start_at,
      (chosen.finals_ends_on+x.ends_at) at time zone r.timezone as end_at
    from jsonb_to_recordset(payload) as x(series_id uuid,resource_id uuid,starts_at time,ends_at time)
    join public.reservable_resources r on r.id=x.resource_id
  loop
    if exists (
      select 1 from public.tournament_final_planning_nodes n
      where n.resource_id=entry.resource_id and n.play_date=chosen.finals_ends_on
        and n.starts_at<entry.ends_at and n.ends_at>entry.starts_at
        and not (n.tournament_id=target_tournament_id and n.round='final'
          and exists (select 1 from jsonb_to_recordset(payload) as p(series_id uuid)
            where p.series_id=n.series_id))
    ) then raise exception 'Court occupied by another knockout position' using errcode='23P01'; end if;

    if exists (
      select 1 from public.tournament_match_planning p
      join public.tournament_matches m on m.id=p.match_id
      where p.resource_id=entry.resource_id and p.play_date=chosen.finals_ends_on
        and p.starts_at<entry.ends_at and p.ends_at>entry.starts_at
        and not (m.tournament_id=target_tournament_id and m.phase='finals'
          and m.final_round='final'
          and exists (select 1 from jsonb_to_recordset(payload) as x(series_id uuid)
            where x.series_id=m.series_id))
    ) then raise exception 'Court occupied by another tournament fixture' using errcode='23P01'; end if;

    if exists (
      select 1 from public.reservations res
      where res.resource_id=entry.resource_id
        and res.status::text in ('pending','confirmed','completed')
        and res.starts_at<entry.end_at and res.ends_at>entry.start_at
    ) then raise exception 'Court occupied by an existing reservation' using errcode='23P01'; end if;

    if exists (
      select 1 from public.calendar_occupations occ
      where occ.resource_id=entry.resource_id and occ.cancelled_at is null
        and occ.starts_at<entry.end_at and occ.ends_at>entry.start_at
        and not exists (
          select 1 from public.event_resources er
          join public.tournament_match_events me on me.event_id=er.event_id
          join public.tournament_matches m on m.id=me.match_id
          where er.calendar_occupation_id=occ.id
            and m.tournament_id=target_tournament_id
            and m.phase='finals' and m.final_round='final'
            and exists (select 1 from jsonb_to_recordset(payload) as p(series_id uuid)
              where p.series_id=m.series_id)
        )
    ) then raise exception 'Court occupied by another calendar event' using errcode='23P01'; end if;

    -- The final must follow its actual preceding dependencies.
    if exists (
      select 1 from public.tournament_matches m
      join public.tournament_match_planning plan on plan.match_id=m.id
      join public.tournament_final_planning_nodes finale
        on finale.tournament_id=m.tournament_id and finale.series_id=m.series_id
          and finale.round='final'
      where m.tournament_id=target_tournament_id and m.series_id=entry.series_id
        and m.phase='finals' and m.final_round<>'final'
        and public.tournament_final_node_depends_on(
          m.series_id,finale.round_number,finale.display_order,
          m.final_round_number,m.display_order
        )
        and plan.play_date+plan.ends_at >= chosen.finals_ends_on+entry.starts_at
    ) then raise exception 'Final cannot precede its qualifier' using errcode='P0001'; end if;
  end loop;

  -- Release old calendar occupations for the finals in this batch before
  -- moving them, so swapping two published finals is atomic.
  delete from public.calendar_occupations occ
  using public.event_resources er
  join public.tournament_match_events me on me.event_id=er.event_id
  join public.tournament_matches m on m.id=me.match_id
  where occ.id=er.calendar_occupation_id
    and m.tournament_id=target_tournament_id and m.phase='finals'
    and m.final_round='final'
    and exists (select 1 from jsonb_to_recordset(payload) as p(series_id uuid)
      where p.series_id=m.series_id);

  for entry in
    select x.series_id,x.resource_id,x.starts_at,x.ends_at
    from jsonb_to_recordset(payload) as x(series_id uuid,resource_id uuid,starts_at time,ends_at time)
  loop
    update public.tournament_final_planning_nodes n
    set resource_id=entry.resource_id,play_date=chosen.finals_ends_on,
        starts_at=entry.starts_at,ends_at=entry.ends_at,
        source='manual',updated_at=now()
    where n.tournament_id=target_tournament_id and n.series_id=entry.series_id
      and n.round='final';

    select * into current_match from public.tournament_matches m
    where m.tournament_id=target_tournament_id and m.series_id=entry.series_id
      and m.phase='finals' and m.final_round='final'
    limit 1;
    if current_match.id is not null then
      insert into public.tournament_match_planning(
        match_id,tournament_id,resource_id,play_date,starts_at,ends_at,source,updated_at
      ) values (
        current_match.id,target_tournament_id,entry.resource_id,
        chosen.finals_ends_on,entry.starts_at,entry.ends_at,'manual',now()
      ) on conflict (match_id) do update set
        resource_id=excluded.resource_id,play_date=excluded.play_date,
        starts_at=excluded.starts_at,ends_at=excluded.ends_at,
        source='manual',updated_at=now();
      update public.tournament_matches set status='scheduled',updated_at=now()
      where id=current_match.id and status='to_schedule';

      if exists (select 1 from public.tournament_match_events where match_id=current_match.id)
      then
        perform public.sync_tournament_reschedule_match_event(
          current_match.id,entry.resource_id,chosen.finals_ends_on,
          entry.starts_at,entry.ends_at
        );
        insert into public.tournament_audit_log(
          tournament_id,action,before_status,after_status,payload,created_by
        ) values (
          target_tournament_id,'match_reprogrammed',chosen.status,chosen.status,
          jsonb_build_object('match_id',current_match.id,'resource_id',entry.resource_id,
            'play_date',chosen.finals_ends_on,'starts_at',entry.starts_at,'ends_at',entry.ends_at),
          auth.uid()
        );
      end if;
    end if;
    affected_series_ids:=array_append(affected_series_ids,entry.series_id);
  end loop;

  -- Actual teams becoming known later will find this preserved manual slot;
  -- publication is delegated to the existing automatic engine.
  foreach series_to_publish in array affected_series_ids loop
    perform public.auto_progress_independent_tournament_final_branches(
      target_tournament_id, series_to_publish
    );
  end loop;

  insert into public.tournament_audit_log(
    tournament_id,action,before_status,after_status,payload,created_by
  ) values (
    target_tournament_id,'final_day_lineup_updated',chosen.status,chosen.status,
    jsonb_build_object('finals',payload,'day',chosen.finals_ends_on),auth.uid()
  );
  return changes;
end;
$function$;

revoke all on function public.admin_save_tournament_final_day_lineup(uuid,jsonb)
from public,anon,authenticated;
grant execute on function public.admin_save_tournament_final_day_lineup(uuid,jsonb) to authenticated;

-- Show the organizer's reserved FINAL running order, even if opponents are
-- not determined. This is a label, never a fake reservation or match.
create or replace function public.list_public_tournament_final_day_program(
  target_resource_id uuid, range_start date, range_end date
)
returns table(
  starts_at timestamptz,ends_at timestamptz,display_name text,
  display_color text,series_id uuid, published boolean
)
language sql stable security definer set search_path=''
as $function$
  select
    (node.play_date+node.starts_at) at time zone resource.timezone,
    (node.play_date+node.ends_at) at time zone resource.timezone,
    concat('Finale ',series.name,
      case when m.team_a_id is not null and m.team_b_id is not null then
        concat(' · ',public.tournament_team_public_label(m.team_a_id),
          ' — ',public.tournament_team_public_label(m.team_b_id))
      else ' · Adversaires à déterminer' end),
    series.color,node.series_id,
    exists(select 1 from public.tournament_match_events link
      join public.events e on e.id=link.event_id and e.publication_status='published'
      where link.match_id=m.id)
  from public.reservable_resources resource
  join public.tournaments t on t.club_id=resource.club_id
  join public.tournament_final_planning_nodes node
    on node.tournament_id=t.id and node.resource_id=resource.id and node.round='final'
  join public.tournament_series series
    on series.id=node.series_id and series.tournament_id=t.id
  left join public.tournament_matches m
    on m.tournament_id=node.tournament_id and m.series_id=node.series_id
      and m.phase='finals' and m.final_round='final'
      and m.final_round_number=node.round_number and m.display_order=node.display_order
  where resource.id=target_resource_id and resource.is_active
    and t.status in ('planning_published','in_progress')
    and node.play_date between range_start and range_end
    and node.play_date=t.finals_ends_on
    and node.starts_at is not null and node.ends_at is not null
    and node.source='manual'
  order by node.play_date,node.starts_at,series.display_order;
$function$;
revoke all on function public.list_public_tournament_final_day_program(uuid,date,date)
from public,anon,authenticated;
grant execute on function public.list_public_tournament_final_day_program(uuid,date,date)
to anon,authenticated;
commit;