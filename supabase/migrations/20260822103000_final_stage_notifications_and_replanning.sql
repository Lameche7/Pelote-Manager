begin;

-- Complète l'activation des phases finales :
-- - notification ciblée à chaque publication/republication d'un match final ;
-- - rappels du matin et de saisie de score compatibles avec les matchs sans poule ;
-- - retrait du tour courant du calendrier pour permettre une replanification.

alter table public.tournament_match_reminder_events
  drop constraint if exists tournament_match_reminder_events_reminder_kind_check;

alter table public.tournament_match_reminder_events
  add constraint tournament_match_reminder_events_reminder_kind_check
  check (
    reminder_kind in (
      'match_day_10h',
      'result_entry_due',
      'final_round_published'
    )
  );

create or replace function public.tournament_final_round_label(target_round text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case target_round
    when 'preliminary' then 'barrage'
    when 'round_of_32' then '1/16 de finale'
    when 'round_of_16' then '1/8 de finale'
    when 'quarterfinal' then 'quart de finale'
    when 'semifinal' then 'demi-finale'
    when 'final' then 'finale'
    else replace(coalesce(target_round, 'phase finale'), '_', ' ')
  end;
$$;

revoke all on function public.tournament_final_round_label(text)
from public, anon, authenticated;

create or replace function public.publish_tournament_final_match_publication_notification(
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
  target_expires_at timestamptz;
begin
  select
    tournament.id as tournament_id,
    tournament.club_id,
    tournament.name as tournament_name,
    match.id as match_id,
    match.team_a_id,
    match.team_b_id,
    match.final_round,
    series.name as series_name,
    planning.play_date,
    planning.starts_at,
    planning.ends_at,
    resource.name as resource_name,
    resource.timezone as resource_timezone
  into target
  from public.tournament_matches as match
  join public.tournaments as tournament on tournament.id = match.tournament_id
  join public.tournament_series as series on series.id = match.series_id
  join public.tournament_match_planning as planning on planning.match_id = match.id
  join public.reservable_resources as resource on resource.id = planning.resource_id
  join public.tournament_match_events as link on link.match_id = match.id
  join public.events as event on event.id = link.event_id
  where match.id = target_match_id
    and match.phase = 'finals'
    and target_team_id in (match.team_a_id, match.team_b_id)
    and event.publication_status = 'published';

  if not found then
    return 0;
  end if;

  if exists (
    select 1
    from public.tournament_match_reminder_events as reminder
    where reminder.match_id = target.match_id
      and reminder.team_id = target_team_id
      and reminder.reminder_kind = 'final_round_published'
  ) then
    return 0;
  end if;

  opponent_label := public.tournament_team_public_label(
    case
      when target.team_a_id = target_team_id then target.team_b_id
      else target.team_a_id
    end
  );

  target_expires_at := public.tournament_planning_starts_at(
    target.play_date,
    target.ends_at,
    target.resource_timezone
  ) + interval '2 hours';

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
    concat('Phase finale : ', target.tournament_name),
    concat(
      'Votre ', public.tournament_final_round_label(target.final_round),
      ' contre ', opponent_label,
      ' est programmée le ', to_char(target.play_date, 'DD/MM'),
      ' à ', to_char(target.starts_at, 'HH24:MI'),
      ' sur ', target.resource_name,
      '. Retrouvez la rencontre dans Mes tournois.'
    ),
    'important',
    'draft',
    false,
    target_expires_at,
    auth.uid(),
    auth.uid()
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
    'final_round_published',
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
    auth.uid(),
    jsonb_build_object(
      'source', 'tournament_final_publication',
      'tournament_id', target.tournament_id,
      'match_id', target.match_id,
      'team_id', target_team_id,
      'reminder_kind', 'final_round_published'
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
      and reminder_kind = 'final_round_published';

    delete from public.club_communications
    where id = target_communication_id;

    return 0;
  end if;

  update public.club_communications
  set
    status = 'published',
    published_at = now(),
    updated_at = now(),
    updated_by = auth.uid()
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
    auth.uid(),
    jsonb_build_object(
      'source', 'tournament_final_publication',
      'tournament_id', target.tournament_id,
      'match_id', target.match_id,
      'team_id', target_team_id,
      'reminder_kind', 'final_round_published',
      'recipient_count', target_recipient_count
    )
  );

  return target_recipient_count;
end;
$$;

revoke all on function public.publish_tournament_final_match_publication_notification(uuid, uuid)
from public, anon, authenticated;

create or replace function public.notify_tournament_final_match_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_match public.tournament_matches;
begin
  select match.*
  into target_match
  from public.tournament_matches as match
  where match.id = new.match_id;

  if target_match.id is null or target_match.phase <> 'finals' then
    return new;
  end if;

  perform public.publish_tournament_final_match_publication_notification(
    target_match.id,
    target_match.team_a_id
  );
  perform public.publish_tournament_final_match_publication_notification(
    target_match.id,
    target_match.team_b_id
  );

  return new;
end;
$$;

revoke all on function public.notify_tournament_final_match_publication()
from public, anon, authenticated;

drop trigger if exists tournament_final_match_publication_notification
on public.tournament_match_events;

create trigger tournament_final_match_publication_notification
after insert on public.tournament_match_events
for each row
execute function public.notify_tournament_final_match_publication();

-- Le rappel de 10 h accepte désormais les matchs de poule et de phase finale.
create or replace function public.publish_tournament_match_day_reminder(
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
  target_expires_at timestamptz;
  match_context text;
begin
  select
    tournament.id as tournament_id,
    tournament.club_id,
    tournament.name as tournament_name,
    tournament.timezone as tournament_timezone,
    match.id as match_id,
    match.team_a_id,
    match.team_b_id,
    match.phase,
    match.final_round,
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
  left join public.tournament_pools as pool on pool.id = match.pool_id
  join public.tournament_match_planning as planning on planning.match_id = match.id
  join public.reservable_resources as resource on resource.id = planning.resource_id
  where match.id = target_match_id
    and target_team_id in (match.team_a_id, match.team_b_id)
    and tournament.status in ('planning_published', 'in_progress');

  if not found then
    return 0;
  end if;

  if target.play_date <> (now() at time zone target.tournament_timezone)::date
    or (now() at time zone target.tournament_timezone)::time < time '10:00' then
    return 0;
  end if;

  target_expires_at := public.tournament_planning_starts_at(
    target.play_date,
    target.ends_at,
    target.resource_timezone
  ) + interval '2 hours';

  if target_expires_at <= now() then
    return 0;
  end if;

  if exists (
    select 1
    from public.tournament_match_reminder_events as event
    where event.match_id = target.match_id
      and event.team_id = target_team_id
      and event.reminder_kind = 'match_day_10h'
  ) then
    return 0;
  end if;

  opponent_label := public.tournament_team_public_label(
    case
      when target.team_a_id = target_team_id then target.team_b_id
      else target.team_a_id
    end
  );

  match_context := case
    when target.phase = 'finals' then
      concat('Série ', target.series_name, ' – ', public.tournament_final_round_label(target.final_round))
    else
      concat('Série ', target.series_name, ' – Poule ', target.pool_number)
  end;

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
    concat('Votre match aujourd’hui : ', target.tournament_name),
    concat(
      match_context,
      '. Adversaires : ', opponent_label,
      '. Terrain : ', target.resource_name,
      '. Horaire : ', to_char(target.starts_at, 'HH24:MI'), '.'
    ),
    'important',
    'draft',
    false,
    target_expires_at,
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
    'match_day_10h',
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
      'source', 'tournament_match_cron',
      'tournament_id', target.tournament_id,
      'match_id', target.match_id,
      'team_id', target_team_id,
      'reminder_kind', 'match_day_10h'
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
      and reminder_kind = 'match_day_10h';

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
      'source', 'tournament_match_cron',
      'tournament_id', target.tournament_id,
      'match_id', target.match_id,
      'team_id', target_team_id,
      'reminder_kind', 'match_day_10h',
      'recipient_count', target_recipient_count
    )
  );

  return target_recipient_count;
end;
$$;

revoke all on function public.publish_tournament_match_day_reminder(uuid, uuid)
from public, anon, authenticated;

-- Le rappel post-match utilise la même projection, sans dépendre d'une poule.
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
    match.id as match_id,
    match.team_a_id,
    match.team_b_id,
    planning.play_date,
    planning.starts_at,
    planning.ends_at,
    resource.timezone as resource_timezone
  into target
  from public.tournament_matches as match
  join public.tournaments as tournament on tournament.id = match.tournament_id
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

create or replace function public.admin_unpublish_tournament_final_round(
  target_tournament_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_tournament public.tournaments;
  item record;
  saved_event public.events;
  unpublished_count integer := 0;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id
    and tournament.club_id = target_club_id
  for update;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  perform set_config('app.allow_tournament_event_sync', 'on', true);

  for item in
    select
      match.id as match_id,
      link.event_id
    from public.tournament_matches as match
    join public.tournament_match_events as link on link.match_id = match.id
    join public.events as event on event.id = link.event_id
    left join public.tournament_match_results as result on result.match_id = match.id
    where match.tournament_id = target_tournament.id
      and match.phase = 'finals'
      and result.id is null
      and event.publication_status = 'published'
    order by match.final_round_number, match.display_order
  loop
    saved_event := null;

    update public.events as event
    set
      publication_status = 'archived',
      updated_at = now(),
      updated_by = auth.uid()
    where event.id = item.event_id
    returning event.* into saved_event;

    if saved_event.id is not null then
      perform public.sync_event_occupations(saved_event);
    end if;

    update public.club_communications as communication
    set
      status = 'archived',
      archived_at = coalesce(communication.archived_at, now()),
      updated_at = now(),
      updated_by = auth.uid()
    where communication.id in (
      select reminder.communication_id
      from public.tournament_match_reminder_events as reminder
      where reminder.match_id = item.match_id
        and reminder.reminder_kind = 'final_round_published'
    )
      and communication.status = 'published';

    delete from public.tournament_match_reminder_events as reminder
    where reminder.match_id = item.match_id
      and reminder.reminder_kind = 'final_round_published';

    delete from public.tournament_match_events as link
    where link.match_id = item.match_id;

    unpublished_count := unpublished_count + 1;
  end loop;

  if unpublished_count = 0 then
    raise exception 'No published tournament finals matches are ready for replanning'
      using errcode = 'P0001';
  end if;

  return unpublished_count;
end;
$$;

revoke all on function public.admin_unpublish_tournament_final_round(uuid)
from public, anon, authenticated;
grant execute on function public.admin_unpublish_tournament_final_round(uuid)
to authenticated;

commit;
