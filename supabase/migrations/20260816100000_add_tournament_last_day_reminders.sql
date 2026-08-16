begin;

-- Rappels automatiques le dernier jour des inscriptions.
-- Le cron tourne régulièrement, mais la fonction métier décide selon le fuseau
-- du tournoi et ne publie qu'une seule fois chaque audience grâce à
-- tournament_notification_events.

create extension if not exists pg_cron;

alter table public.tournament_notification_events
  drop constraint if exists tournament_notification_events_event_kind_check;

alter table public.tournament_notification_events
  add constraint tournament_notification_events_event_kind_check
  check (
    event_kind in (
      'announced',
      'registrations_opened',
      'registration_last_day_registered',
      'registration_last_day_unregistered'
    )
  );

create or replace function public.publish_tournament_last_day_reminder(
  target_tournament_id uuid,
  target_audience text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
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
  left join public.profiles as profile on profile.member_id = member.id
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
$$;

revoke all on function public.publish_tournament_last_day_reminder(uuid, text)
from public, anon, authenticated;

create or replace function public.publish_due_tournament_registration_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tournament_id uuid;
  published_recipients integer := 0;
begin
  for target_tournament_id in
    select tournament.id
    from public.tournaments as tournament
    where tournament.status = 'registrations_open'
      and tournament.registration_opens_at <= now()
      and tournament.registration_closes_at > now()
      and (
        tournament.registration_closes_at at time zone tournament.timezone
      )::date = (now() at time zone tournament.timezone)::date
      and (now() at time zone tournament.timezone)::time >= time '13:00'
  loop
    published_recipients := published_recipients
      + public.publish_tournament_last_day_reminder(
          target_tournament_id,
          'registered'
        );
    published_recipients := published_recipients
      + public.publish_tournament_last_day_reminder(
          target_tournament_id,
          'unregistered'
        );
  end loop;

  return published_recipients;
end;
$$;

revoke all on function public.publish_due_tournament_registration_reminders()
from public, anon, authenticated;

-- Le cron est volontairement fréquent : l'heure métier est évaluée dans le
-- fuseau de chaque tournoi. L'idempotence empêche tout doublon.
select cron.schedule(
  'pelote-manager-tournament-last-day-reminders',
  '*/15 * * * *',
  $$select public.publish_due_tournament_registration_reminders();$$
);

-- Si la migration est appliquée après 13 h le jour même, le rappel part tout
-- de suite sans attendre le prochain passage du cron.
select public.publish_due_tournament_registration_reminders();

commit;
