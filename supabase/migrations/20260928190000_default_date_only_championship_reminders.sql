begin;

-- Une partie sans horaire réel reste une partie "date seule".
-- Pour les rappels, on lui attribue une fenêtre conventionnelle 10:00 -> 20:00
-- le jour importé. Ainsi le rappel du matin part à 10 h et la demande de
-- résultat à 20 h. Une réservation ou une programmation manuelle prime toujours.
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
      coalesce(target.agreement_time, target.report_time, target.scheduled_time) as scheduled_time,
      coalesce(nullif(btrim(target.agreement_venue), ''), nullif(btrim(target.venue), '')) as venue
    from target
  )
  select
    coalesce(
      active_reservation.starts_at,
      (manual.scheduled_on + manual.scheduled_time) at time zone 'Europe/Paris',
      case
        when fallback.scheduled_on is null then null
        when fallback.scheduled_time is null
          then (fallback.scheduled_on + time '10:00') at time zone 'Europe/Paris'
        else (fallback.scheduled_on + fallback.scheduled_time) at time zone 'Europe/Paris'
      end
    ),
    coalesce(
      active_reservation.ends_at,
      ((manual.scheduled_on + manual.scheduled_time) at time zone 'Europe/Paris') + interval '2 hours',
      case
        when fallback.scheduled_on is null then null
        when fallback.scheduled_time is null
          then (fallback.scheduled_on + time '20:00') at time zone 'Europe/Paris'
        else ((fallback.scheduled_on + fallback.scheduled_time) at time zone 'Europe/Paris') + interval '2 hours'
      end
    ),
    coalesce(active_reservation.venue, manual.venue, fallback.venue),
    case
      when active_reservation.starts_at is not null then 'reservation'
      when manual.scheduled_on is not null then 'manual'
      when fallback.scheduled_time is null then 'import_date_only'
      else 'import'
    end
  from fallback
  left join active_reservation on true
  left join manual on true;
$$;

revoke all on function public.championship_match_effective_schedule(uuid)
from public, anon, authenticated;

-- Le rappel du matin ne doit pas inventer "10:00" comme heure de partie
-- lorsque la source ne contient qu'une date.
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
  if target_reminder_kind not in ('part_day_10h', 'result_entry_due') then return 0; end if;

  select
    match.id as match_id, championship.id as championship_id,
    championship.name as championship_name, championship.timezone,
    link.club_id, my_team.id as my_team_id,
    opponent.source_label as opponent_label,
    effective.starts_at, effective.ends_at, effective.venue, effective.source
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
    on my_team.id = case when team1.federation_club_id = link.federation_club_id then team1.id else team2.id end
  join public.championship_teams as opponent
    on opponent.id = case when my_team.id = team1.id then team2.id else team1.id end
  cross join lateral public.championship_match_effective_schedule(match.id) as effective
  where match.id = target_match_id
    and championship.status = 'active'
    and match.status not in ('cancelled', 'forfeit')
    and match.score_raw is null and match.score_team1 is null and match.score_team2 is null;

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
    where event.match_id = target.match_id and event.club_id = target.club_id
      and event.reminder_kind = target_reminder_kind
  ) then return 0; end if;

  insert into public.club_communications (
    club_id, title, body, priority, status, show_on_home, expires_at, created_by, updated_by
  )
  values (
    target.club_id,
    case when target_reminder_kind = 'part_day_10h'
      then concat('Championnat aujourd’hui : ', target.championship_name)
      else concat('Résultat à saisir : ', target.championship_name) end,
    case
      when target_reminder_kind = 'part_day_10h' and target.source = 'import_date_only' then concat(
        'Votre partie contre ', target.opponent_label, ' est prévue aujourd’hui',
        case when target.venue is not null then concat(' · ', target.venue) else '' end, '.'
      )
      when target_reminder_kind = 'part_day_10h' then concat(
        'Votre partie contre ', target.opponent_label, ' est programmée aujourd’hui à ',
        to_char(target.starts_at at time zone target.timezone, 'HH24:MI'),
        case when target.venue is not null then concat(' · ', target.venue) else '' end, '.'
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
    select distinct player.profile_id, member.id as club_member_id,
      coalesce(nullif(btrim(member.email), ''), nullif(btrim(profile.email), '')) as email_snapshot
    from public.championship_team_players as team_player
    join public.championship_players as player on player.id = team_player.player_id
    join public.profiles as profile on profile.id = player.profile_id
    left join public.club_members as member
      on member.id = profile.member_id and member.club_id = target.club_id and member.is_active
    where team_player.team_id = target.my_team_id
      and player.link_status in ('claimed', 'verified')
  )
  insert into public.communication_deliveries (
    communication_id, club_id, club_member_id, profile_id_at_publication, email_snapshot, email_status
  )
  select target_communication_id, target.club_id, candidate.club_member_id,
    candidate.profile_id, candidate.email_snapshot,
    case when candidate.email_snapshot is null
      then 'unavailable'::public.communication_email_status
      else 'not_configured'::public.communication_email_status end
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

  insert into public.communication_audit_log (club_id, communication_id, action, actor_id, new_data)
  values (
    target.club_id, target_communication_id, 'published', null,
    jsonb_build_object('source', 'championship_match_reminder_cron',
      'championship_id', target.championship_id, 'match_id', target.match_id,
      'team_id', target.my_team_id, 'reminder_kind', target_reminder_kind,
      'recipient_count', target_recipient_count)
  );

  return target_recipient_count;
end;
$$;

revoke all on function public.publish_championship_match_reminder(uuid, uuid, text)
from public, anon, authenticated;

commit;
