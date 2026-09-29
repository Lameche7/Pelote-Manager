begin;

-- Résout le profil global correspondant à une fiche membre locale.
create or replace function public.club_member_profile_id(target_member_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id
  from public.club_members as member
  join public.profiles as profile
    on (
      member.sport_player_id is not null
      and profile.sport_player_id = member.sport_player_id
    )
    or (
      profile.sport_player_id is null
      and profile.member_id = member.id
    )
  where member.id = target_member_id
  order by
    case when member.sport_player_id is not null
      and profile.sport_player_id = member.sport_player_id then 0 else 1 end,
    profile.updated_at desc,
    profile.id
  limit 1;
$$;

revoke all on function public.club_member_profile_id(uuid)
from public, anon, authenticated;

-- Les règles métier de ciblage restent inchangées ; seule la résolution du profil
-- passe par l'identité sportive globale, avec fallback legacy pour les profils non migrés.
CREATE OR REPLACE FUNCTION public.publish_tournament_final_match_publication_notification(target_match_id uuid, target_team_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      on member_profile.id = public.club_member_profile_id(member.id)
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
$function$;


CREATE OR REPLACE FUNCTION public.publish_tournament_match_day_reminder(target_match_id uuid, target_team_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      on member_profile.id = public.club_member_profile_id(member.id)
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
$function$;


CREATE OR REPLACE FUNCTION public.publish_tournament_match_result_reminder(target_match_id uuid, target_team_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      on member_profile.id = public.club_member_profile_id(member.id)
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
$function$;


CREATE OR REPLACE FUNCTION public.publish_tournament_planning_notification(target_tournament_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target public.tournaments%rowtype;
  target_communication_id uuid;
  target_recipient_count integer := 0;
  target_expires_at timestamptz;
begin
  select tournament.*
  into target
  from public.tournaments as tournament
  where tournament.id = target_tournament_id
    and tournament.status = 'planning_published';

  if not found then
    return 0;
  end if;

  if exists (
    select 1
    from public.tournament_notification_events as event
    where event.tournament_id = target.id
      and event.event_kind = 'planning_published'
  ) then
    return 0;
  end if;

  target_expires_at := greatest(
    ((target.ends_on + 1)::timestamp at time zone target.timezone),
    now() + interval '1 hour'
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
    concat('Planning publié : ', target.name),
    concat(
      'Le planning du tournoi « ', target.name, ' » est disponible. ',
      'Consultez vos matchs, adversaires, horaires et terrains dans Mes tournois.'
    ),
    'important',
    'draft',
    false,
    target_expires_at,
    null,
    null
  )
  returning id into target_communication_id;

  insert into public.tournament_notification_events (
    tournament_id,
    event_kind,
    communication_id
  )
  values (
    target.id,
    'planning_published',
    target_communication_id
  )
  on conflict (tournament_id, event_kind) do nothing;

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
      'source', 'tournament_planning_publication',
      'tournament_id', target.id,
      'event_kind', 'planning_published'
    )
  );

  with participant_players as (
    select distinct
      player.member_id,
      player.email
    from public.tournament_team_players as player
    where player.tournament_id = target.id
      and exists (
        select 1
        from public.tournament_matches as match
        where match.tournament_id = target.id
          and player.team_id in (match.team_a_id, match.team_b_id)
      )
  ),
  recipient_candidates as (
    select distinct
      member.id as club_member_id,
      coalesce(member_profile.id, external_profile.id) as profile_id,
      coalesce(
        nullif(btrim(player.email), ''),
        nullif(btrim(member.email), ''),
        nullif(btrim(member_profile.email), ''),
        nullif(btrim(external_profile.email), '')
      ) as email_snapshot
    from participant_players as player
    left join public.club_members as member
      on member.id = player.member_id
     and member.club_id = target.club_id
     and member.is_active
    left join public.profiles as member_profile
      on member_profile.id = public.club_member_profile_id(member.id)
    left join lateral (
      select profile.id, profile.email
      from public.profiles as profile
      where member.id is null
        and nullif(btrim(player.email), '') is not null
        and lower(btrim(profile.email)) = lower(btrim(player.email))
      order by profile.id
      limit 1
    ) as external_profile on true
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
    delete from public.tournament_notification_events
    where tournament_id = target.id
      and event_kind = 'planning_published';

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
      'source', 'tournament_planning_publication',
      'tournament_id', target.id,
      'event_kind', 'planning_published',
      'recipient_count', target_recipient_count
    )
  );

  return target_recipient_count;
end;
$function$;


CREATE OR REPLACE FUNCTION public.publish_tournament_reschedule_approval_notification(target_request_id uuid, target_team_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target record;
  target_communication_id uuid;
  target_recipient_count integer := 0;
  requester_label text;
begin
  select
    request.id as request_id,
    request.tournament_id,
    request.requester_team_id,
    request.requested_by,
    request.status as request_status,
    request.expires_at,
    tournament.club_id,
    tournament.name as tournament_name,
    approval.decision
  into target
  from public.tournament_reschedule_requests as request
  join public.tournaments as tournament on tournament.id = request.tournament_id
  join public.tournament_reschedule_approvals as approval
    on approval.request_id = request.id
   and approval.team_id = target_team_id
  where request.id = target_request_id
    and request.status = 'pending'
    and approval.decision = 'pending'
    and approval.team_id <> request.requester_team_id;

  if not found then
    return 0;
  end if;

  if exists (
    select 1
    from public.tournament_reschedule_notification_events as event
    where event.request_id = target.request_id
      and event.team_id = target_team_id
      and event.event_kind = 'approval_requested'
  ) then
    return 0;
  end if;

  requester_label := public.tournament_team_public_label(target.requester_team_id);

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
    concat('Demande de report : ', target.tournament_name),
    concat(
      requester_label,
      ' demande le report d’une partie qui concerne votre équipe. ',
      'Ouvrez « Reports à traiter » pour accepter ou refuser la proposition.'
    ),
    'important',
    'draft',
    false,
    target.expires_at,
    target.requested_by,
    target.requested_by
  )
  returning id into target_communication_id;

  insert into public.tournament_reschedule_notification_events (
    request_id,
    team_id,
    event_kind,
    communication_id
  )
  values (
    target.request_id,
    target_team_id,
    'approval_requested',
    target_communication_id
  )
  on conflict (request_id, team_id, event_kind) do nothing;

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
    target.requested_by,
    jsonb_build_object(
      'source', 'tournament_reschedule',
      'request_id', target.request_id,
      'tournament_id', target.tournament_id,
      'team_id', target_team_id,
      'event_kind', 'approval_requested'
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
      on member_profile.id = public.club_member_profile_id(member.id)
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
    delete from public.tournament_reschedule_notification_events
    where request_id = target.request_id
      and team_id = target_team_id
      and event_kind = 'approval_requested';

    delete from public.club_communications
    where id = target_communication_id;

    return 0;
  end if;

  update public.club_communications
  set
    status = 'published',
    published_at = now(),
    updated_at = now(),
    updated_by = target.requested_by
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
    target.requested_by,
    jsonb_build_object(
      'source', 'tournament_reschedule',
      'request_id', target.request_id,
      'tournament_id', target.tournament_id,
      'team_id', target_team_id,
      'event_kind', 'approval_requested',
      'recipient_count', target_recipient_count
    )
  );

  return target_recipient_count;
end;
$function$


commit;
