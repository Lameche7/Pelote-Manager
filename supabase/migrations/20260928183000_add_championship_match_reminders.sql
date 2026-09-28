begin;

create extension if not exists pg_cron;

create table public.championship_match_reminder_events (
  match_id uuid not null references public.championship_matches(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  reminder_kind text not null check (reminder_kind in ('part_day_10h', 'result_entry_due')),
  communication_id uuid not null references public.club_communications(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (match_id, club_id, reminder_kind),
  unique (communication_id)
);

alter table public.championship_match_reminder_events enable row level security;
revoke all on table public.championship_match_reminder_events from public, anon, authenticated;

create or replace function public.championship_match_effective_schedule(target_match_id uuid)
returns table (
  starts_at timestamptz,
  ends_at timestamptz,
  venue text,
  source text
)
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select match.*
    from public.championship_matches as match
    where match.id = target_match_id
  ),
  active_reservation as (
    select reservation.starts_at, reservation.ends_at, resource.name as venue
    from public.reservations as reservation
    join public.reservable_resources as resource on resource.id = reservation.resource_id
    where reservation.championship_match_id = target_match_id
      and reservation.status in ('pending', 'confirmed')
    order by reservation.starts_at
    limit 1
  ),
  manual as (
    select schedule.scheduled_on, schedule.scheduled_time, schedule.venue
    from public.championship_match_manual_schedules as schedule
    where schedule.match_id = target_match_id
  ),
  fallback as (
    select
      coalesce(target.agreement_on, target.report_on, target.scheduled_on) as scheduled_on,
      coalesce(target.agreement_time, target.report_time, target.scheduled_time, time '00:00') as scheduled_time,
      coalesce(nullif(btrim(target.agreement_venue), ''), nullif(btrim(target.venue), '')) as venue
    from target
  )
  select
    coalesce(
      active_reservation.starts_at,
      (manual.scheduled_on + manual.scheduled_time) at time zone 'Europe/Paris',
      (fallback.scheduled_on + fallback.scheduled_time) at time zone 'Europe/Paris'
    ),
    coalesce(
      active_reservation.ends_at,
      ((manual.scheduled_on + manual.scheduled_time) at time zone 'Europe/Paris') + interval '2 hours',
      ((fallback.scheduled_on + fallback.scheduled_time) at time zone 'Europe/Paris') + interval '2 hours'
    ),
    coalesce(active_reservation.venue, manual.venue, fallback.venue),
    case
      when active_reservation.starts_at is not null then 'reservation'
      when manual.scheduled_on is not null then 'manual'
      else 'import'
    end
  from fallback
  left join active_reservation on true
  left join manual on true;
$$;

revoke all on function public.championship_match_effective_schedule(uuid)
from public, anon, authenticated;

create or replace function public.publish_championship_match_reminder(
  target_match_id uuid,
  target_club_id uuid,
  target_reminder_kind text
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
  target_expires_at timestamptz;
begin
  if target_reminder_kind not in ('part_day_10h', 'result_entry_due') then
    return 0;
  end if;

  select
    match.id as match_id,
    championship.id as championship_id,
    championship.name as championship_name,
    championship.timezone,
    link.club_id,
    my_team.id as my_team_id,
    opponent.source_label as opponent_label,
    effective.starts_at,
    effective.ends_at,
    effective.venue
  into target
  from public.championship_matches as match
  join public.championship_divisions as division on division.id = match.division_id
  join public.championships as championship on championship.id = division.championship_id
  join public.championship_teams as team1 on team1.id = match.team1_id
  join public.championship_teams as team2 on team2.id = match.team2_id
  join public.championship_club_links as link
    on link.championship_id = championship.id
   and link.club_id = target_club_id
   and link.federation_club_id in (team1.federation_club_id, team2.federation_club_id)
  join public.championship_teams as my_team
    on my_team.id = case
      when team1.federation_club_id = link.federation_club_id then team1.id
      else team2.id
    end
  join public.championship_teams as opponent
    on opponent.id = case when my_team.id = team1.id then team2.id else team1.id end
  cross join lateral public.championship_match_effective_schedule(match.id) as effective
  where match.id = target_match_id
    and championship.status = 'active'
    and match.status not in ('cancelled', 'forfeit')
    and match.score_raw is null
    and match.score_team1 is null
    and match.score_team2 is null;

  if not found or target.starts_at is null then return 0; end if;

  if target_reminder_kind = 'part_day_10h' then
    if (target.starts_at at time zone target.timezone)::date <> (now() at time zone target.timezone)::date
      or (now() at time zone target.timezone)::time < time '10:00'
      or target.ends_at <= now()
    then return 0; end if;
    target_expires_at := target.ends_at + interval '2 hours';
  else
    if target.ends_at > now()
      or target.ends_at <= now() - interval '12 hours'
      or exists (
        select 1 from public.championship_result_submissions as submission
        where submission.match_id = target.match_id
          and submission.team_id = target.my_team_id
          and submission.status = 'pending'
      )
    then return 0; end if;
    target_expires_at := now() + interval '12 hours';
  end if;

  if exists (
    select 1 from public.championship_match_reminder_events as event
    where event.match_id = target.match_id
      and event.club_id = target.club_id
      and event.reminder_kind = target_reminder_kind
  ) then return 0; end if;

  insert into public.club_communications (
    club_id, title, body, priority, status, show_on_home, expires_at, created_by, updated_by
  )
  values (
    target.club_id,
    case
      when target_reminder_kind = 'part_day_10h'
        then concat('Championnat aujourd’hui : ', target.championship_name)
      else concat('Résultat à saisir : ', target.championship_name)
    end,
    case
      when target_reminder_kind = 'part_day_10h' then concat(
        'Votre partie contre ', target.opponent_label, ' est programmée aujourd’hui à ',
        to_char(target.starts_at at time zone target.timezone, 'HH24:MI'),
        case when target.venue is not null then concat(' · ', target.venue) else '' end,
        '.'
      )
      else concat(
        'Votre partie contre ', target.opponent_label,
        ' est terminée. Saisissez le résultat dans Mes championnats.'
      )
    end,
    'important', 'draft', false, target_expires_at, null, null
  )
  returning id into target_communication_id;

  insert into public.championship_match_reminder_events (
    match_id, club_id, reminder_kind, communication_id
  )
  values (target.match_id, target.club_id, target_reminder_kind, target_communication_id)
  on conflict (match_id, club_id, reminder_kind) do nothing;

  if not found then
    delete from public.club_communications where id = target_communication_id;
    return 0;
  end if;

  with recipient_candidates as (
    select distinct
      player.profile_id,
      member.id as club_member_id,
      coalesce(nullif(btrim(member.email), ''), nullif(btrim(profile.email), '')) as email_snapshot
    from public.championship_team_players as team_player
    join public.championship_players as player on player.id = team_player.player_id
    join public.profiles as profile on profile.id = player.profile_id
    left join public.club_members as member
      on member.id = profile.member_id
     and member.club_id = target.club_id
     and member.is_active
    where team_player.team_id = target.my_team_id
      and player.link_status in ('claimed', 'verified')
  )
  insert into public.communication_deliveries (
    communication_id, club_id, club_member_id, profile_id_at_publication, email_snapshot, email_status
  )
  select
    target_communication_id,
    target.club_id,
    candidate.club_member_id,
    candidate.profile_id,
    candidate.email_snapshot,
    case when candidate.email_snapshot is null
      then 'unavailable'::public.communication_email_status
      else 'not_configured'::public.communication_email_status
    end
  from recipient_candidates as candidate
  on conflict do nothing;

  get diagnostics target_recipient_count = row_count;

  if target_recipient_count = 0 then
    delete from public.championship_match_reminder_events
    where match_id = target.match_id and club_id = target.club_id and reminder_kind = target_reminder_kind;
    delete from public.club_communications where id = target_communication_id;
    return 0;
  end if;

  update public.club_communications
  set status = 'published', published_at = now(), updated_at = now()
  where id = target_communication_id;

  insert into public.communication_audit_log (
    club_id, communication_id, action, actor_id, new_data
  )
  values (
    target.club_id, target_communication_id, 'published', null,
    jsonb_build_object(
      'source', 'championship_match_reminder_cron',
      'championship_id', target.championship_id,
      'match_id', target.match_id,
      'team_id', target.my_team_id,
      'reminder_kind', target_reminder_kind,
      'recipient_count', target_recipient_count
    )
  );

  return target_recipient_count;
end;
$$;

revoke all on function public.publish_championship_match_reminder(uuid, uuid, text)
from public, anon, authenticated;

create or replace function public.publish_due_championship_match_reminders()
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
    select distinct match.id as match_id, link.club_id
    from public.championship_matches as match
    join public.championship_divisions as division on division.id = match.division_id
    join public.championships as championship on championship.id = division.championship_id
    join public.championship_teams as team1 on team1.id = match.team1_id
    join public.championship_teams as team2 on team2.id = match.team2_id
    join public.championship_club_links as link
      on link.championship_id = championship.id
     and link.federation_club_id in (team1.federation_club_id, team2.federation_club_id)
    cross join lateral public.championship_match_effective_schedule(match.id) as effective
    where championship.status = 'active'
      and effective.starts_at is not null
      and (effective.starts_at at time zone championship.timezone)::date =
          (now() at time zone championship.timezone)::date
      and (now() at time zone championship.timezone)::time >= time '10:00'
      and effective.ends_at > now()
  loop
    published_recipients := published_recipients
      + public.publish_championship_match_reminder(due.match_id, due.club_id, 'part_day_10h');
  end loop;

  for due in
    select distinct match.id as match_id, link.club_id
    from public.championship_matches as match
    join public.championship_divisions as division on division.id = match.division_id
    join public.championships as championship on championship.id = division.championship_id
    join public.championship_teams as team1 on team1.id = match.team1_id
    join public.championship_teams as team2 on team2.id = match.team2_id
    join public.championship_club_links as link
      on link.championship_id = championship.id
     and link.federation_club_id in (team1.federation_club_id, team2.federation_club_id)
    cross join lateral public.championship_match_effective_schedule(match.id) as effective
    where championship.status = 'active'
      and effective.ends_at <= now()
      and effective.ends_at > now() - interval '12 hours'
  loop
    published_recipients := published_recipients
      + public.publish_championship_match_reminder(due.match_id, due.club_id, 'result_entry_due');
  end loop;

  return published_recipients;
end;
$$;

revoke all on function public.publish_due_championship_match_reminders()
from public, anon, authenticated;

create or replace function public.archive_championship_result_entry_reminders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'pending' then
    update public.club_communications as communication
    set status = 'archived', archived_at = coalesce(communication.archived_at, now()), updated_at = now()
    where communication.id in (
      select event.communication_id
      from public.championship_match_reminder_events as event
      join public.championship_matches as match on match.id = event.match_id
      join public.championship_teams as team on team.id = new.team_id
      join public.championship_divisions as division on division.id = team.division_id
      join public.championship_club_links as link
        on link.championship_id = division.championship_id
       and link.federation_club_id = team.federation_club_id
       and link.club_id = event.club_id
      where event.match_id = new.match_id
        and event.reminder_kind = 'result_entry_due'
    )
      and communication.status = 'published';
  end if;
  return new;
end;
$$;

revoke all on function public.archive_championship_result_entry_reminders()
from public, anon, authenticated;

drop trigger if exists championship_results_archive_entry_reminders
on public.championship_result_submissions;

create trigger championship_results_archive_entry_reminders
after insert on public.championship_result_submissions
for each row
execute function public.archive_championship_result_entry_reminders();

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
language sql stable security definer set search_path = ''
as $$
  select
    deliveries.id, communications.id, communications.title, communications.body,
    communications.priority, communications.published_at, communications.expires_at,
    deliveries.read_at,
    communications.status = 'published'
      and (communications.expires_at is null or communications.expires_at > now()),
    case
      when championship_reminder.match_id is not null then
        format('/mon-espace/championnats?match=%s', championship_reminder.match_id)
      when payment_request.payment_id is not null then
        format('/reservations/paiement-part?paymentId=%s', payment_request.payment_id)
      when permanent_slot_reminder.occurrence_id is not null then '/mon-espace/creneaux-permanents'
      when reschedule_event.request_id is not null then '/mon-espace/tournois'
      when admin_event.tournament_id is not null then '/admin/tournois'
      when match_event.match_id is not null then format('/mon-espace/tournois?match=%s', match_event.match_id)
      when tournament_event.event_kind = 'planning_published' then '/mon-espace/tournois'
      when tournament_event.tournament_id is not null then format('/tournois/%s#inscription', tournament_event.tournament_id)
      when communications.title like 'Créneau libéré · %' then '/reservations'
      else null
    end
  from public.communication_deliveries as deliveries
  join public.club_communications as communications
    on communications.id = deliveries.communication_id and communications.club_id = deliveries.club_id
  left join public.championship_match_reminder_events as championship_reminder
    on championship_reminder.communication_id = communications.id
  left join public.reservation_payment_notification_events as payment_request
    on payment_request.communication_id = communications.id
  left join public.permanent_slot_reminder_events as permanent_slot_reminder
    on permanent_slot_reminder.communication_id = communications.id
  left join public.tournament_notification_events as tournament_event
    on tournament_event.communication_id = communications.id
  left join public.tournament_match_reminder_events as match_event
    on match_event.communication_id = communications.id
  left join public.tournament_admin_reminder_events as admin_event
    on admin_event.communication_id = communications.id
  left join public.tournament_reschedule_notification_events as reschedule_event
    on reschedule_event.communication_id = communications.id
  where (
      deliveries.profile_id_at_publication = auth.uid()
      or exists (
        select 1 from public.profiles as profile
        join public.club_members as member on member.id = profile.member_id
        where profile.id = auth.uid()
          and member.id = deliveries.club_member_id
          and member.club_id = deliveries.club_id
          and member.is_active
      )
    )
    and deliveries.deleted_at is null
    and communications.status in ('published', 'archived')
  order by communications.published_at desc nulls last, communications.id desc;
$$;

revoke all on function public.list_my_notifications_v2() from public, anon;
grant execute on function public.list_my_notifications_v2() to authenticated;

select cron.unschedule(jobid)
from cron.job
where jobname = 'pilotoki-championship-match-reminders';

select cron.schedule(
  'pilotoki-championship-match-reminders',
  '*/5 * * * *',
  $$select public.publish_due_championship_match_reminders();$$
);

commit;
