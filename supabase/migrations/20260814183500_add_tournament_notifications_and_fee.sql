begin;

-- Tarif d'inscription par équipe + notifications métier de cycle de tournoi.
-- Les notifications passent exclusivement par le moteur central
-- club_communications -> communication_deliveries -> Web Push.

alter table public.tournaments
add column if not exists registration_fee_cents integer not null default 0;

alter table public.tournaments
drop constraint if exists tournaments_registration_fee_cents_check;

alter table public.tournaments
add constraint tournaments_registration_fee_cents_check
check (registration_fee_cents >= 0);

create table if not exists public.tournament_notification_events (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  event_kind text not null check (
    event_kind in ('announced', 'registrations_opened')
  ),
  communication_id uuid not null references public.club_communications(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tournament_id, event_kind),
  unique (communication_id)
);

alter table public.tournament_notification_events enable row level security;
revoke all on table public.tournament_notification_events
from public, anon, authenticated;

create or replace function public.tournament_registration_fee_label(
  target_fee_cents integer
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when coalesce(target_fee_cents, 0) = 0 then 'Inscription gratuite.'
    else format(
      'Tarif : %s,%s € par équipe.',
      coalesce(target_fee_cents, 0) / 100,
      lpad((coalesce(target_fee_cents, 0) % 100)::text, 2, '0')
    )
  end;
$$;

revoke all on function public.tournament_registration_fee_label(integer)
from public, anon, authenticated;

-- Conserve les RPC existantes pour ne pas multiplier les contrats front-end.
create or replace function public.admin_get_tournament_with_finals_minimum(
  target_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  base_payload jsonb;
  target_minimum integer;
  target_fee_cents integer;
begin
  base_payload := public.admin_get_tournament(target_id);

  select
    tournament.minimum_finals_availability_slots,
    tournament.registration_fee_cents
  into target_minimum, target_fee_cents
  from public.tournaments as tournament
  where tournament.id = target_id;

  return base_payload || jsonb_build_object(
    'minimum_finals_availability_slots', coalesce(target_minimum, 35),
    'registration_fee_cents', coalesce(target_fee_cents, 0)
  );
end;
$$;

create or replace function public.admin_create_tournament_with_finals_minimum(
  payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
  target_minimum integer := coalesce(
    nullif(payload->>'minimum_finals_availability_slots', '')::integer,
    35
  );
  target_fee_cents integer := coalesce(
    nullif(payload->>'registration_fee_cents', '')::integer,
    0
  );
begin
  if target_minimum < 0 then
    raise exception 'Tournament availability settings are invalid'
      using errcode = '22023';
  end if;

  if target_fee_cents < 0 then
    raise exception 'Tournament registration fee is invalid'
      using errcode = '22023';
  end if;

  target_id := public.admin_create_tournament(payload);

  update public.tournaments
  set
    minimum_finals_availability_slots = target_minimum,
    registration_fee_cents = target_fee_cents,
    updated_by = auth.uid(),
    updated_at = now()
  where id = target_id;

  return target_id;
end;
$$;

create or replace function public.admin_update_tournament_with_finals_minimum(
  target_id uuid,
  payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_minimum integer := coalesce(
    nullif(payload->>'minimum_finals_availability_slots', '')::integer,
    35
  );
  target_fee_cents integer := coalesce(
    nullif(payload->>'registration_fee_cents', '')::integer,
    0
  );
  previous_minimum integer;
  previous_fee_cents integer;
  previous_status public.tournament_status;
  active_team_id uuid;
begin
  if target_minimum < 0 then
    raise exception 'Tournament availability settings are invalid'
      using errcode = '22023';
  end if;

  if target_fee_cents < 0 then
    raise exception 'Tournament registration fee is invalid'
      using errcode = '22023';
  end if;

  select
    tournament.minimum_finals_availability_slots,
    tournament.registration_fee_cents,
    tournament.status
  into previous_minimum, previous_fee_cents, previous_status
  from public.tournaments as tournament
  where tournament.id = target_id;

  if previous_fee_cents is distinct from target_fee_cents
    and previous_status not in ('preparation', 'configuration') then
    raise exception 'Tournament registration fee is locked after registrations open'
      using errcode = 'P0001';
  end if;

  perform public.admin_update_tournament(target_id, payload);

  update public.tournaments
  set
    minimum_finals_availability_slots = target_minimum,
    registration_fee_cents = target_fee_cents,
    updated_by = auth.uid(),
    updated_at = now()
  where id = target_id;

  for active_team_id in
    select team.id
    from public.tournament_teams as team
    where team.tournament_id = target_id
      and team.status in ('pending', 'accepted')
  loop
    perform public.assert_tournament_team_finals_availability(active_team_id);
  end loop;

  if previous_minimum is distinct from target_minimum then
    insert into public.tournament_audit_log (
      tournament_id,
      action,
      payload,
      created_by
    )
    values (
      target_id,
      'finals_availability_minimum_updated',
      jsonb_build_object(
        'before', previous_minimum,
        'after', target_minimum
      ),
      auth.uid()
    );
  end if;

  if previous_fee_cents is distinct from target_fee_cents then
    insert into public.tournament_audit_log (
      tournament_id,
      action,
      payload,
      created_by
    )
    values (
      target_id,
      'registration_fee_updated',
      jsonb_build_object(
        'before_cents', previous_fee_cents,
        'after_cents', target_fee_cents
      ),
      auth.uid()
    );
  end if;
end;
$$;

create or replace function public.publish_tournament_lifecycle_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
  left join public.profiles as profile on profile.member_id = member.id
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
$$;

revoke all on function public.publish_tournament_lifecycle_notification()
from public, anon, authenticated;

drop trigger if exists tournaments_publish_lifecycle_notification
on public.tournaments;

create trigger tournaments_publish_lifecycle_notification
after update of status on public.tournaments
for each row
execute function public.publish_tournament_lifecycle_notification();

revoke all on function public.admin_get_tournament_with_finals_minimum(uuid)
from public, anon, authenticated;
revoke all on function public.admin_create_tournament_with_finals_minimum(jsonb)
from public, anon, authenticated;
revoke all on function public.admin_update_tournament_with_finals_minimum(uuid, jsonb)
from public, anon, authenticated;

grant execute on function public.admin_get_tournament_with_finals_minimum(uuid)
to authenticated;
grant execute on function public.admin_create_tournament_with_finals_minimum(jsonb)
to authenticated;
grant execute on function public.admin_update_tournament_with_finals_minimum(uuid, jsonb)
to authenticated;

commit;
