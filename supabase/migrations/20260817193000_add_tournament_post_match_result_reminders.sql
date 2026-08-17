begin;

-- Après la fin théorique d'une partie, rappelle aux joueurs de transmettre le score.
-- Le cron ne fait que détecter l'échéance : les notifications restent publiées via
-- le moteur central club_communications -> communication_deliveries -> Web Push.
create extension if not exists pg_cron;

alter table public.tournament_match_reminder_events
  drop constraint if exists tournament_match_reminder_events_reminder_kind_check;

alter table public.tournament_match_reminder_events
  add constraint tournament_match_reminder_events_reminder_kind_check
  check (reminder_kind in ('match_day_10h', 'result_entry_due'));

create or replace function public.publish_tournament_match_result_reminder(
  target_match_id uuid,
  target_team_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
  target_communication_id uuid;
  target_recipient_count integer := 0;
  opponent_label text;
  match_ends_at timestamptz;
begin
  select
    tournament.id as tournament_id,
    tournament.club_id,
    tournament.name as tournament_name,
    tournament.status as tournament_status,
    match.id as match_id,
    match.team_a_id,
    match.team_b_id,
    series.name as series_name,
    pool.display_order + 1 as pool_number,
    planning.play_date,
    planning.starts_at,
    planning.ends_at,
    resource.name as resource_name,
    resource.timezone as resource_timezone
  into target
  from public.tournament_matches as match
  join public.tournaments as tournament on tournament.id = match.tournament_id
  join public.tournament_series as series on series.id = match.series_id
  join public.tournament_pools as pool on pool.id = match.pool_id
  join public.tournament_match_planning as planning on planning.match_id = match.id
  join public.reservable_resources as resource on resource.id = planning.resource_id
  where match.id = target_match_id
    and target_team_id in (match.team_a_id, match.team_b_id)
    and tournament.status in ('planning_published', 'in_progress');

  if not found then
    return 0;
  end if;

  match_ends_at := public.tournament_planning_starts_at(
    target.play_date,
    target.ends_at,
    target.resource_timezone
  );

  if match_ends_at > now() then
    return 0;
  end if;

  if exists (
    select 1
    from public.tournament_match_results as result
    where result.match_id = target.match_id
  ) then
    return 0;
  end if;

  if exists (
    select 1
    from public.tournament_match_reminder_events as event
    where event.match_id = target.match_id
      and event.team_id = target_team_id
      and event.reminder_kind = 'result_entry_due'
  ) then
    return 0;
  end if;

  opponent_label := public.tournament_team_public_label(
    case
      when target.team_a_id = target_team_id then target.team_b_id
      else target.team_a_id
    end
  );

  insert into public.club_communications (
    club_id,
    title,
    body,
    priority,
    status,
    show_on_home,
    expires_at,
    created_by,
    updated_by
  )
  values (
    target.club_id,
    concat('Score à saisir : ', target.tournament_name),
    concat(
      'Votre partie contre ', opponent_label,
      ' est terminée. Saisissez maintenant le résultat dans Mes tournois ',
      'pour le transmettre au club.'
    ),
    'important',
    'draft',
    false,
    now() + interval '12 hours',
    null,
    null
  )
  returning id into target_communication_id;

  insert into public.tournament_match_reminder_events (
    match_id,
    team_id,
    reminder_kind,
    communication_id
  )
  values (
    target.match_id,
    target_team_id,
    'result_entry_due',
    target_communication_id
  )
  on conflict (match_id, team_id, reminder_kind) do nothing;

  if not found then
    delete from public.club_communications
    where id = target_communication_id;
    return 0;
  end if;

  insert into public.communication_audit_log (
    club_id,
    communication_id,
    action,
    actor_id,
    new_data
  )
  values (
    target.club_id,
    target_communication_id,
    'created',
    null,
    jsonb_build_object(
      'source', 'tournament_result_entry_cron',
      'tournament_id', target.tournament_id,
      'match_id', target.match_id,
      'team_id', target_team_id,
      'reminder_kind', 'result_entry_due'
    )
  );

  with recipient_candidates as (
    select distinct
      member.id as club_member_id,
      coalesce(member_profile.id, external_profile.id) as profile_id,
      coalesce(
        nullif(btrim(player.email), ''),
        nullif(btrim(member.email), ''),
        nullif(btrim(member_profile.email), ''),
        nullif(btrim(external_profile.email), '')
      ) as email_snapshot
    from public.tournament_team_players as player
    left join public.club_members as member
      on member.id = player.member_id
     and member.club_id = target.club_id
     and member.is_active
    left join public.profiles as member_profile
      on member_profile.member_id = member.id
    left join lateral (
      select profile.id, profile.email
      from public.profiles as profile
      where member.id is null
        and nullif(btrim(player.email), '') is not null
        and lower(btrim(profile.email)) = lower(btrim(player.email))
      order by profile.id
      limit 1
    ) as external_profile on true
    where player.team_id = target_team_id
      and player.tournament_id = target.tournament_id
  )
  insert into public.communication_deliveries (
    communication_id,
    club_id,
    club_member_id,
    profile_id_at_publication,
    email_snapshot,
    email_status
  )
  select
    target_communication_id,
    target.club_id,
    candidate.club_member_id,
    candidate.profile_id,
    candidate.email_snapshot,
    case
      when candidate.email_snapshot is null
        then 'unavailable'::public.communication_email_status
      else 'not_configured'::public.communication_email_status
    end
  from recipient_candidates as candidate
  where candidate.club_member_id is not null
     or candidate.profile_id is not null
  on conflict do nothing;

  get diagnostics target_recipient_count = row_count;

  if target_recipient_count = 0 then
    delete from public.tournament_match_reminder_events
    where match_id = target.match_id
      and team_id = target_team_id
      and reminder_kind = 'result_entry_due';

    delete from public.club_communications
    where id = target_communication_id;

    return 0;
  end if;

  update public.club_communications
  set
    status = 'published',
    published_at = now(),
    updated_at = now()
  where id = target_communication_id;

  insert into public.communication_audit_log (
    club_id,
    communication_id,
    action,
    actor_id,
    new_data
  )
  values (
    target.club_id,
    target_communication_id,
    'published',
    null,
    jsonb_build_object(
      'source', 'tournament_result_entry_cron',
      'tournament_id', target.tournament_id,
      'match_id', target.match_id,
      'team_id', target_team_id,
      'reminder_kind', 'result_entry_due',
      'recipient_count', target_recipient_count
    )
  );

  return target_recipient_count;
end;
$$;

revoke all on function public.publish_tournament_match_result_reminder(uuid, uuid)
from public, anon, authenticated;

create or replace function public.publish_due_tournament_match_result_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  due record;
  published_recipients integer := 0;
begin
  for due in
    select match.id as match_id, side.team_id
    from public.tournament_matches as match
    join public.tournaments as tournament on tournament.id = match.tournament_id
    join public.tournament_match_planning as planning on planning.match_id = match.id
    join public.reservable_resources as resource on resource.id = planning.resource_id
    cross join lateral (
      values (match.team_a_id), (match.team_b_id)
    ) as side(team_id)
    where tournament.status in ('planning_published', 'in_progress')
      and public.tournament_planning_starts_at(
        planning.play_date,
        planning.ends_at,
        resource.timezone
      ) <= now()
      and public.tournament_planning_starts_at(
        planning.play_date,
        planning.ends_at,
        resource.timezone
      ) > now() - interval '12 hours'
      and not exists (
        select 1
        from public.tournament_match_results as result
        where result.match_id = match.id
      )
  loop
    published_recipients := published_recipients
      + public.publish_tournament_match_result_reminder(
          due.match_id,
          due.team_id
        );
  end loop;

  return published_recipients;
end;
$$;

revoke all on function public.publish_due_tournament_match_result_reminders()
from public, anon, authenticated;

-- Une fois le score saisi, le rappel n'est plus une action active dans le centre
-- de notifications et ne compte plus parmi les notifications non lues.
create or replace function public.archive_tournament_result_entry_reminders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.club_communications as communication
  set
    status = 'archived',
    updated_at = now()
  where communication.id in (
    select event.communication_id
    from public.tournament_match_reminder_events as event
    where event.match_id = new.match_id
      and event.reminder_kind = 'result_entry_due'
  )
    and communication.status = 'published';

  return new;
end;
$$;

revoke all on function public.archive_tournament_result_entry_reminders()
from public, anon, authenticated;

drop trigger if exists tournament_results_archive_entry_reminders
on public.tournament_match_results;

create trigger tournament_results_archive_entry_reminders
after insert on public.tournament_match_results
for each row
execute function public.archive_tournament_result_entry_reminders();

-- Les rappels de match (matin ou après-partie) ouvrent la partie concernée.
create or replace function public.list_my_notifications_v2()
returns table (
  delivery_id uuid,
  communication_id uuid,
  title text,
  body text,
  priority public.communication_priority,
  published_at timestamptz,
  expires_at timestamptz,
  read_at timestamptz,
  is_active boolean,
  action_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    deliveries.id,
    communications.id,
    communications.title,
    communications.body,
    communications.priority,
    communications.published_at,
    communications.expires_at,
    deliveries.read_at,
    communications.status = 'published'
      and (communications.expires_at is null or communications.expires_at > now()),
    case
      when admin_event.tournament_id is not null then '/admin/tournois'
      when match_event.match_id is not null then
        format('/mon-espace/tournois?match=%s', match_event.match_id)
      when tournament_event.event_kind = 'planning_published' then '/mon-espace/tournois'
      when tournament_event.tournament_id is not null then
        format('/tournois/%s#inscription', tournament_event.tournament_id)
      else null
    end
  from public.communication_deliveries as deliveries
  join public.club_communications as communications
    on communications.id = deliveries.communication_id
   and communications.club_id = deliveries.club_id
  left join public.tournament_notification_events as tournament_event
    on tournament_event.communication_id = communications.id
  left join public.tournament_match_reminder_events as match_event
    on match_event.communication_id = communications.id
  left join public.tournament_admin_reminder_events as admin_event
    on admin_event.communication_id = communications.id
  where (
      deliveries.profile_id_at_publication = auth.uid()
      or exists (
        select 1
        from public.profiles as profile
        join public.club_members as member on member.id = profile.member_id
        where profile.id = auth.uid()
          and member.id = deliveries.club_member_id
          and member.club_id = deliveries.club_id
          and member.is_active
      )
    )
    and communications.status in ('published', 'archived')
  order by communications.published_at desc nulls last, communications.id desc;
$$;

revoke all on function public.list_my_notifications_v2()
from public, anon, authenticated;
grant execute on function public.list_my_notifications_v2()
to authenticated;

select cron.unschedule(jobid)
from cron.job
where jobname = 'pelote-manager-tournament-result-entry-reminders';

select cron.schedule(
  'pelote-manager-tournament-result-entry-reminders',
  '*/5 * * * *',
  $$select public.publish_due_tournament_match_result_reminders();$$
);

-- Rattrape aussi immédiatement les parties terminées depuis moins de 12 heures
-- lors de l'installation de la migration.
select public.publish_due_tournament_match_result_reminders();

commit;
