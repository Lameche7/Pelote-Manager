begin;

-- Notifications tournoi restantes : conserve les audiences métier et remplace
-- uniquement les raccords legacy profil <-> fiche membre locale.
CREATE OR REPLACE FUNCTION public.publish_tournament_reschedule_applied_team_notification(target_request_id uuid, target_team_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target record;
  target_communication_id uuid;
  target_recipient_count integer := 0;
  target_resource_name text;
  target_resource_timezone text;
  target_play_date date;
  target_starts_at time;
  target_ends_at time;
  target_resource_id uuid;
  target_actor uuid;
begin
  select
    request.id as request_id,
    request.tournament_id,
    request.proposal_kind,
    request.swap_match_id,
    request.target_resource_id,
    request.target_play_date,
    request.target_starts_at,
    request.target_ends_at,
    request.swap_return_resource_id,
    request.swap_return_play_date,
    request.swap_return_starts_at,
    request.swap_return_ends_at,
    request.applied_by,
    request.requested_by,
    tournament.club_id,
    tournament.name as tournament_name,
    swap_match.team_a_id as swap_team_a_id,
    swap_match.team_b_id as swap_team_b_id
  into target
  from public.tournament_reschedule_requests as request
  join public.tournaments as tournament on tournament.id = request.tournament_id
  left join public.tournament_matches as swap_match on swap_match.id = request.swap_match_id
  where request.id = target_request_id
    and request.status = 'applied';

  if not found then
    return 0;
  end if;

  if exists (
    select 1
    from public.tournament_reschedule_notification_events as event
    where event.request_id = target.request_id
      and event.team_id = target_team_id
      and event.event_kind = 'applied'
  ) then
    return 0;
  end if;

  if target.proposal_kind = 'swap'
    and target_team_id in (target.swap_team_a_id, target.swap_team_b_id) then
    target_resource_id := target.swap_return_resource_id;
    target_play_date := target.swap_return_play_date;
    target_starts_at := target.swap_return_starts_at;
    target_ends_at := target.swap_return_ends_at;
  else
    target_resource_id := target.target_resource_id;
    target_play_date := target.target_play_date;
    target_starts_at := target.target_starts_at;
    target_ends_at := target.target_ends_at;
  end if;

  select resource.name, resource.timezone
  into target_resource_name, target_resource_timezone
  from public.reservable_resources as resource
  where resource.id = target_resource_id;

  if target_resource_name is null then
    return 0;
  end if;

  target_actor := coalesce(target.applied_by, target.requested_by);

  insert into public.club_communications(
    club_id, title, body, priority, status, show_on_home,
    expires_at, created_by, updated_by
  ) values (
    target.club_id,
    concat('Report appliqué : ', target.tournament_name),
    concat(
      'La nouvelle programmation de votre équipe est confirmée : ',
      to_char(target_play_date, 'DD/MM/YYYY'),
      ' à ', to_char(target_starts_at, 'HH24:MI'),
      ' sur ', target_resource_name, '.'
    ),
    'important',
    'draft',
    false,
    public.tournament_planning_starts_at(
      target_play_date,
      target_starts_at,
      target_resource_timezone
    ) + interval '1 day',
    target_actor,
    target_actor
  )
  returning id into target_communication_id;

  insert into public.tournament_reschedule_notification_events(
    request_id, team_id, event_kind, communication_id
  ) values (
    target.request_id, target_team_id, 'applied', target_communication_id
  )
  on conflict (request_id, team_id, event_kind) do nothing;

  if not found then
    delete from public.club_communications where id = target_communication_id;
    return 0;
  end if;

  insert into public.communication_audit_log(
    club_id, communication_id, action, actor_id, new_data
  ) values (
    target.club_id,
    target_communication_id,
    'created',
    target_actor,
    jsonb_build_object(
      'source', 'tournament_reschedule',
      'request_id', target.request_id,
      'tournament_id', target.tournament_id,
      'team_id', target_team_id,
      'event_kind', 'applied'
    )
  );

  with recipients as (
    select distinct
      member.id as club_member_id,
      profile.id as profile_id,
      nullif(btrim(profile.email), '') as email_snapshot
    from public.profiles as profile
    left join public.club_members as member
      on member.id = public.profile_club_member_id(profile.id, target.club_id)
    where public.tournament_profile_is_linked_to_team(target_team_id, profile.id)
  )
  insert into public.communication_deliveries(
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
    recipient.club_member_id,
    recipient.profile_id,
    recipient.email_snapshot,
    case
      when recipient.email_snapshot is null
        then 'unavailable'::public.communication_email_status
      else 'not_configured'::public.communication_email_status
    end
  from recipients as recipient
  on conflict do nothing;

  get diagnostics target_recipient_count = row_count;

  if target_recipient_count = 0 then
    delete from public.tournament_reschedule_notification_events
    where request_id = target.request_id
      and team_id = target_team_id
      and event_kind = 'applied';
    delete from public.club_communications where id = target_communication_id;
    return 0;
  end if;

  update public.club_communications
  set
    status = 'published',
    published_at = now(),
    updated_at = now(),
    updated_by = target_actor
  where id = target_communication_id;

  insert into public.communication_audit_log(
    club_id, communication_id, action, actor_id, new_data
  ) values (
    target.club_id,
    target_communication_id,
    'published',
    target_actor,
    jsonb_build_object(
      'source', 'tournament_reschedule',
      'request_id', target.request_id,
      'tournament_id', target.tournament_id,
      'team_id', target_team_id,
      'event_kind', 'applied',
      'recipient_count', target_recipient_count
    )
  );

  return target_recipient_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.publish_tournament_last_day_reminder(target_tournament_id uuid, target_audience text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_tournament public.tournaments%rowtype;
  target_event_kind text;
  target_title text;
  target_body text;
  target_communication_id uuid;
  target_recipient_count integer := 0;
  registration_closes_local text;
  local_now timestamp;
begin
  if target_audience not in ('registered', 'unregistered') then
    raise exception 'Unsupported tournament reminder audience'
      using errcode = '22023';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id
    and tournament.status = 'registrations_open'
    and tournament.registration_opens_at <= now()
    and tournament.registration_closes_at > now();

  if not found then
    return 0;
  end if;

  local_now := now() at time zone target_tournament.timezone;

  if (target_tournament.registration_closes_at at time zone target_tournament.timezone)::date
      <> local_now::date
    or local_now::time < time '13:00' then
    return 0;
  end if;

  target_event_kind := case target_audience
    when 'registered' then 'registration_last_day_registered'
    else 'registration_last_day_unregistered'
  end;

  if exists (
    select 1
    from public.tournament_notification_events as event
    where event.tournament_id = target_tournament.id
      and event.event_kind = target_event_kind
  ) then
    return 0;
  end if;

  -- Ne pas relancer les non-inscrits si toutes les séries actives sont pleines.
  if target_audience = 'unregistered'
    and not exists (
      select 1
      from public.tournament_series as series
      where series.tournament_id = target_tournament.id
        and series.enabled
        and public.tournament_series_reserved_count(series.id, null) < series.capacity
    ) then
    return 0;
  end if;

  registration_closes_local := to_char(
    target_tournament.registration_closes_at at time zone target_tournament.timezone,
    'DD/MM/YYYY à HH24:MI'
  );

  if target_audience = 'registered' then
    target_title := concat('Dernier jour pour modifier : ', target_tournament.name);
    target_body := concat(
      'Les inscriptions au tournoi « ', target_tournament.name,
      ' » ferment aujourd’hui à ',
      to_char(
        target_tournament.registration_closes_at at time zone target_tournament.timezone,
        'HH24:MI'
      ),
      '. Vérifiez votre équipe et vos disponibilités : vous pouvez encore les modifier avant la clôture.'
    );
  else
    target_title := concat('Dernier jour pour vous inscrire : ', target_tournament.name);
    target_body := concat(
      'Les inscriptions au tournoi « ', target_tournament.name,
      ' » ferment aujourd’hui à ',
      to_char(
        target_tournament.registration_closes_at at time zone target_tournament.timezone,
        'HH24:MI'
      ),
      '. Il est encore temps de vous inscrire. ',
      public.tournament_registration_fee_label(target_tournament.registration_fee_cents)
    );
  end if;

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
    target_tournament.club_id,
    target_title,
    target_body,
    'important',
    'draft',
    false,
    target_tournament.registration_closes_at,
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
    target_tournament.id,
    target_event_kind,
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
    target_tournament.club_id,
    target_communication_id,
    'created',
    null,
    jsonb_build_object(
      'source', 'tournament_cron',
      'tournament_id', target_tournament.id,
      'event_kind', target_event_kind,
      'audience', target_audience,
      'registration_closes_local', registration_closes_local
    )
  );

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
    target_tournament.club_id,
    member.id,
    profile.id,
    coalesce(
      nullif(btrim(member.email), ''),
      nullif(btrim(profile.email), '')
    ),
    case
      when coalesce(
        nullif(btrim(member.email), ''),
        nullif(btrim(profile.email), '')
      ) is null
        then 'unavailable'::public.communication_email_status
      else 'not_configured'::public.communication_email_status
    end
  from public.club_members as member
  left join public.profiles as profile
    on profile.id = public.club_member_profile_id(member.id)
  where member.club_id = target_tournament.club_id
    and member.is_active
    and (
      (
        target_audience = 'registered'
        and exists (
          select 1
          from public.tournament_team_players as player
          join public.tournament_teams as team on team.id = player.team_id
          where player.tournament_id = target_tournament.id
            and player.member_id = member.id
            and team.status in ('pending', 'accepted')
        )
      )
      or (
        target_audience = 'unregistered'
        and not exists (
          select 1
          from public.tournament_team_players as player
          join public.tournament_teams as team on team.id = player.team_id
          where player.tournament_id = target_tournament.id
            and player.member_id = member.id
            and team.status in ('pending', 'accepted')
        )
      )
    )
  on conflict (communication_id, club_member_id) do nothing;

  get diagnostics target_recipient_count = row_count;

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
    target_tournament.club_id,
    target_communication_id,
    'published',
    null,
    jsonb_build_object(
      'source', 'tournament_cron',
      'tournament_id', target_tournament.id,
      'event_kind', target_event_kind,
      'audience', target_audience,
      'recipient_count', target_recipient_count
    )
  );

  return target_recipient_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.publish_tournament_lifecycle_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_event_kind text;
  target_title text;
  target_body text;
  target_communication_id uuid;
  actor_id uuid := auth.uid();
  registration_opens_local text;
  registration_closes_local text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'configuration' and old.status = 'preparation' then
    target_event_kind := 'announced';
  elsif new.status = 'registrations_open'
    and old.status = 'configuration' then
    target_event_kind := 'registrations_opened';
  else
    return new;
  end if;

  if exists (
    select 1
    from public.tournament_notification_events as event
    where event.tournament_id = new.id
      and event.event_kind = target_event_kind
  ) then
    return new;
  end if;

  registration_opens_local := to_char(
    new.registration_opens_at at time zone new.timezone,
    'DD/MM/YYYY à HH24:MI'
  );
  registration_closes_local := to_char(
    new.registration_closes_at at time zone new.timezone,
    'DD/MM/YYYY à HH24:MI'
  );

  if target_event_kind = 'announced' then
    target_title := concat('Nouveau tournoi : ', new.name);
    target_body := concat(
      'Le tournoi « ', new.name, ' » est annoncé. ',
      'Les inscriptions ouvriront le ', registration_opens_local, '. ',
      public.tournament_registration_fee_label(new.registration_fee_cents)
    );
  else
    target_title := concat('Inscriptions ouvertes : ', new.name);
    target_body := concat(
      'Les inscriptions au tournoi « ', new.name, ' » sont ouvertes jusqu’au ',
      registration_closes_local, '. ',
      public.tournament_registration_fee_label(new.registration_fee_cents)
    );
  end if;

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
    new.club_id,
    target_title,
    target_body,
    'normal',
    'draft',
    false,
    new.registration_closes_at,
    actor_id,
    actor_id
  )
  returning id into target_communication_id;

  insert into public.tournament_notification_events (
    tournament_id,
    event_kind,
    communication_id
  )
  values (
    new.id,
    target_event_kind,
    target_communication_id
  )
  on conflict (tournament_id, event_kind) do nothing;

  if not found then
    delete from public.club_communications
    where id = target_communication_id;
    return new;
  end if;

  insert into public.communication_audit_log (
    club_id,
    communication_id,
    action,
    actor_id,
    new_data
  )
  values (
    new.club_id,
    target_communication_id,
    'created',
    actor_id,
    jsonb_build_object(
      'source', 'tournament',
      'tournament_id', new.id,
      'event_kind', target_event_kind
    )
  );

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
    new.club_id,
    member.id,
    profile.id,
    coalesce(
      nullif(btrim(member.email), ''),
      nullif(btrim(profile.email), '')
    ),
    case
      when coalesce(
        nullif(btrim(member.email), ''),
        nullif(btrim(profile.email), '')
      ) is null
        then 'unavailable'::public.communication_email_status
      else 'not_configured'::public.communication_email_status
    end
  from public.club_members as member
  left join public.profiles as profile
    on profile.id = public.club_member_profile_id(member.id)
  where member.club_id = new.club_id
    and member.is_active
  on conflict (communication_id, club_member_id) do nothing;

  update public.club_communications
  set
    status = 'published',
    published_at = now(),
    updated_at = now(),
    updated_by = actor_id
  where id = target_communication_id;

  insert into public.communication_audit_log (
    club_id,
    communication_id,
    action,
    actor_id,
    new_data
  )
  values (
    new.club_id,
    target_communication_id,
    'published',
    actor_id,
    jsonb_build_object(
      'source', 'tournament',
      'tournament_id', new.id,
      'event_kind', target_event_kind,
      'recipient_count', (
        select count(*)
        from public.communication_deliveries as delivery
        where delivery.communication_id = target_communication_id
      )
    )
  );

  return new;
end;
$function$
;

commit;
