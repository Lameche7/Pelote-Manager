begin;

-- PR65 — Inscriptions et équipes de tournoi.
-- Les tables restent privées ; seules des projections/RPC dédiées sont exposées.

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'tournament_team_status'
  ) then
    create type public.tournament_team_status as enum (
      'pending',
      'accepted',
      'rejected',
      'withdrawn'
    );
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'tournament_player_role'
  ) then
    create type public.tournament_player_role as enum ('front', 'back');
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'tournament_availability_kind'
  ) then
    create type public.tournament_availability_kind as enum (
      'unavailable',
      'preferred',
      'possible'
    );
  end if;
end
$$;

create table if not exists public.tournament_teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  series_id uuid not null references public.tournament_series (id) on delete restrict,
  status public.tournament_team_status not null default 'pending',
  contact_email text not null check (btrim(contact_email) <> ''),
  contact_phone text not null default '',
  comments text not null default '',
  submitted_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  validated_by uuid references public.profiles (id) on delete set null,
  registered_at timestamptz not null default now(),
  validated_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (id, tournament_id)
);

create table if not exists public.tournament_team_players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  tournament_id uuid not null,
  member_id uuid references public.club_members (id) on delete set null,
  role public.tournament_player_role not null,
  first_name text not null check (btrim(first_name) <> ''),
  last_name text not null check (btrim(last_name) <> ''),
  email text not null default '',
  phone text not null default '',
  display_order smallint not null check (display_order between 0 and 7),
  foreign key (team_id, tournament_id)
    references public.tournament_teams (id, tournament_id)
    on delete cascade,
  unique (team_id, role),
  unique (team_id, display_order)
);

create table if not exists public.tournament_team_availability_rules (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  tournament_id uuid not null,
  kind public.tournament_availability_kind not null,
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  display_order integer not null default 0 check (display_order >= 0),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (team_id, tournament_id)
    references public.tournament_teams (id, tournament_id)
    on delete cascade,
  unique (team_id, kind, weekday, starts_at, ends_at)
);

create index if not exists tournament_teams_tournament_status_idx
on public.tournament_teams (tournament_id, status, series_id, registered_at);

create index if not exists tournament_team_players_tournament_idx
on public.tournament_team_players (tournament_id, team_id, display_order);

create index if not exists tournament_team_players_member_idx
on public.tournament_team_players (tournament_id, member_id)
where member_id is not null;

create index if not exists tournament_team_availability_idx
on public.tournament_team_availability_rules (
  tournament_id,
  team_id,
  weekday,
  starts_at
);

create unique index if not exists tournament_team_submitter_active_unique
on public.tournament_teams (tournament_id, submitted_by)
where submitted_by is not null and status in ('pending', 'accepted');

alter table public.tournament_teams enable row level security;
alter table public.tournament_team_players enable row level security;
alter table public.tournament_team_availability_rules enable row level security;

revoke all on table public.tournament_teams from public, anon, authenticated;
revoke all on table public.tournament_team_players from public, anon, authenticated;
revoke all on table public.tournament_team_availability_rules from public, anon, authenticated;

create or replace function public.tournament_series_reserved_count(
  target_series_id uuid,
  excluded_team_id uuid
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.tournament_teams as team
  where team.series_id = target_series_id
    and team.status in ('pending', 'accepted')
    and (excluded_team_id is null or team.id <> excluded_team_id);
$$;

create or replace function public.tournament_series_has_capacity(
  target_series_id uuid,
  excluded_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select series.enabled
      and public.tournament_series_reserved_count(series.id, excluded_team_id) < series.capacity
    from public.tournament_series as series
    where series.id = target_series_id
  ), false);
$$;

create or replace function public.tournament_registration_is_open(
  target_tournament_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select tournament.status = 'registrations_open'
      and tournament.registration_opens_at <= now()
      and tournament.registration_closes_at > now()
    from public.tournaments as tournament
    where tournament.id = target_tournament_id
  ), false);
$$;

create or replace function public.save_tournament_team_children(
  target_team_id uuid,
  target_tournament_id uuid,
  target_club_id uuid,
  players jsonb,
  availability_rules jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  item_index integer := 0;
  item_member_id uuid;
  item_role text;
  item_first_name text;
  item_last_name text;
  item_kind text;
  item_weekday integer;
  item_starts_at time;
  item_ends_at time;
begin
  if jsonb_typeof(coalesce(players, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(players, '[]'::jsonb)) <> 2 then
    raise exception 'A tournament team must contain exactly two players'
      using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(availability_rules, '[]'::jsonb)) <> 'array' then
    raise exception 'Tournament availability rules are invalid'
      using errcode = '22023';
  end if;

  -- Valider tous les joueurs avant de remplacer les lignes existantes.
  item_index := 0;
  for item in select value from jsonb_array_elements(players)
  loop
    item_role := coalesce(item->>'role', '');
    item_first_name := btrim(coalesce(item->>'first_name', ''));
    item_last_name := btrim(coalesce(item->>'last_name', ''));
    item_member_id := nullif(item->>'member_id', '')::uuid;

    if item_role not in ('front', 'back')
      or item_first_name = ''
      or item_last_name = '' then
      raise exception 'Tournament players are invalid' using errcode = '22023';
    end if;

    if item_member_id is not null then
      if not exists (
        select 1
        from public.club_members as member
        where member.id = item_member_id
          and member.club_id = target_club_id
          and member.is_active
      ) then
        raise exception 'Tournament member is invalid' using errcode = '22023';
      end if;

      if exists (
        select 1
        from public.tournament_team_players as existing_player
        join public.tournament_teams as existing_team
          on existing_team.id = existing_player.team_id
        where existing_player.tournament_id = target_tournament_id
          and existing_player.member_id = item_member_id
          and existing_player.team_id <> target_team_id
          and existing_team.status in ('pending', 'accepted')
      ) then
        raise exception 'A player can only belong to one active team per tournament'
          using errcode = '23505';
      end if;
    end if;

    item_index := item_index + 1;
  end loop;

  if (
    select count(distinct value->>'role')
    from jsonb_array_elements(players)
  ) <> 2 then
    raise exception 'A team must contain one front player and one back player'
      using errcode = '22023';
  end if;

  -- Valider les disponibilités avant remplacement.
  for item in select value from jsonb_array_elements(coalesce(availability_rules, '[]'::jsonb))
  loop
    item_kind := coalesce(item->>'kind', '');
    item_weekday := nullif(item->>'weekday', '')::integer;
    item_starts_at := nullif(item->>'starts_at', '')::time;
    item_ends_at := nullif(item->>'ends_at', '')::time;

    if item_kind not in ('unavailable', 'preferred', 'possible')
      or item_weekday is null
      or item_weekday < 0
      or item_weekday > 6
      or item_starts_at is null
      or item_ends_at is null
      or item_ends_at <= item_starts_at then
      raise exception 'Tournament availability rules are invalid'
        using errcode = '22023';
    end if;
  end loop;

  delete from public.tournament_team_players
  where team_id = target_team_id;

  item_index := 0;
  for item in select value from jsonb_array_elements(players)
  loop
    insert into public.tournament_team_players (
      team_id,
      tournament_id,
      member_id,
      role,
      first_name,
      last_name,
      email,
      phone,
      display_order
    )
    values (
      target_team_id,
      target_tournament_id,
      nullif(item->>'member_id', '')::uuid,
      (item->>'role')::public.tournament_player_role,
      btrim(item->>'first_name'),
      btrim(item->>'last_name'),
      btrim(coalesce(item->>'email', '')),
      btrim(coalesce(item->>'phone', '')),
      item_index
    );
    item_index := item_index + 1;
  end loop;

  delete from public.tournament_team_availability_rules
  where team_id = target_team_id;

  item_index := 0;
  for item in select value from jsonb_array_elements(coalesce(availability_rules, '[]'::jsonb))
  loop
    insert into public.tournament_team_availability_rules (
      team_id,
      tournament_id,
      kind,
      weekday,
      starts_at,
      ends_at,
      display_order
    )
    values (
      target_team_id,
      target_tournament_id,
      (item->>'kind')::public.tournament_availability_kind,
      (item->>'weekday')::smallint,
      (item->>'starts_at')::time,
      (item->>'ends_at')::time,
      item_index
    );
    item_index := item_index + 1;
  end loop;
end;
$$;

revoke all on function public.tournament_series_reserved_count(uuid, uuid) from public, anon, authenticated;
revoke all on function public.tournament_series_has_capacity(uuid, uuid) from public, anon, authenticated;
revoke all on function public.tournament_registration_is_open(uuid) from public, anon, authenticated;
revoke all on function public.save_tournament_team_children(uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;

create or replace function public.list_public_tournaments()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
begin
  for target_club_id in
    select distinct tournament.club_id
    from public.tournaments as tournament
    where tournament.status in ('configuration', 'registrations_open')
  loop
    perform public.sync_tournament_registration_states(target_club_id);
  end loop;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', tournament.id,
          'name', tournament.name,
          'description', tournament.description,
          'starts_on', tournament.starts_on,
          'ends_on', tournament.ends_on,
          'registration_opens_at', tournament.registration_opens_at,
          'registration_closes_at', tournament.registration_closes_at,
          'status', tournament.status,
          'team_count', (
            select count(*)
            from public.tournament_teams as team
            where team.tournament_id = tournament.id
              and team.status = 'accepted'
          ),
          'series', (
            select coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'id', series.id,
                  'name', series.name,
                  'capacity', series.capacity,
                  'accepted_count', (
                    select count(*)
                    from public.tournament_teams as accepted_team
                    where accepted_team.series_id = series.id
                      and accepted_team.status = 'accepted'
                  ),
                  'remaining_slots', greatest(
                    series.capacity - public.tournament_series_reserved_count(series.id, null),
                    0
                  )
                )
                order by series.display_order, series.name
              ),
              '[]'::jsonb
            )
            from public.tournament_series as series
            where series.tournament_id = tournament.id
              and series.enabled
          )
        )
        order by tournament.starts_on desc, tournament.name
      ),
      '[]'::jsonb
    )
    from public.tournaments as tournament
    where tournament.status not in ('preparation', 'configuration', 'cancelled')
  );
end;
$$;

create or replace function public.get_public_tournament(target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
  result jsonb;
begin
  select tournament.club_id
  into target_club_id
  from public.tournaments as tournament
  where tournament.id = target_id;

  if target_club_id is null then
    return null;
  end if;

  perform public.sync_tournament_registration_states(target_club_id);

  select jsonb_build_object(
    'id', tournament.id,
    'name', tournament.name,
    'description', tournament.description,
    'rules', tournament.rules,
    'starts_on', tournament.starts_on,
    'ends_on', tournament.ends_on,
    'registration_opens_at', tournament.registration_opens_at,
    'registration_closes_at', tournament.registration_closes_at,
    'status', tournament.status,
    'can_register', public.tournament_registration_is_open(tournament.id),
    'series', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', series.id,
            'name', series.name,
            'capacity', series.capacity,
            'accepted_count', (
              select count(*)
              from public.tournament_teams as accepted_team
              where accepted_team.series_id = series.id
                and accepted_team.status = 'accepted'
            ),
            'remaining_slots', greatest(
              series.capacity - public.tournament_series_reserved_count(series.id, null),
              0
            )
          )
          order by series.display_order, series.name
        ),
        '[]'::jsonb
      )
      from public.tournament_series as series
      where series.tournament_id = tournament.id
        and series.enabled
    ),
    'teams', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', team.id,
            'series_id', team.series_id,
            'series_name', series.name,
            'players', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'first_name', player.first_name,
                    'last_name', player.last_name,
                    'role', player.role
                  )
                  order by player.display_order
                ),
                '[]'::jsonb
              )
              from public.tournament_team_players as player
              where player.team_id = team.id
            )
          )
          order by series.display_order, team.registered_at, team.id
        ),
        '[]'::jsonb
      )
      from public.tournament_teams as team
      join public.tournament_series as series on series.id = team.series_id
      where team.tournament_id = tournament.id
        and team.status = 'accepted'
    )
  )
  into result
  from public.tournaments as tournament
  where tournament.id = target_id
    and tournament.status not in ('preparation', 'configuration', 'cancelled');

  return result;
end;
$$;

create or replace function public.get_my_tournament_registration(target_tournament_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid := auth.uid();
  result jsonb;
begin
  if target_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', team.id,
    'series_id', team.series_id,
    'status', team.status,
    'contact_email', team.contact_email,
    'contact_phone', team.contact_phone,
    'comments', team.comments,
    'players', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'member_id', player.member_id,
            'first_name', player.first_name,
            'last_name', player.last_name,
            'email', player.email,
            'phone', player.phone,
            'role', player.role
          )
          order by player.display_order
        ),
        '[]'::jsonb
      )
      from public.tournament_team_players as player
      where player.team_id = team.id
    ),
    'availability_rules', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'kind', rule.kind,
            'weekday', rule.weekday,
            'starts_at', rule.starts_at,
            'ends_at', rule.ends_at
          )
          order by rule.display_order, rule.weekday, rule.starts_at
        ),
        '[]'::jsonb
      )
      from public.tournament_team_availability_rules as rule
      where rule.team_id = team.id
    )
  )
  into result
  from public.tournament_teams as team
  where team.tournament_id = target_tournament_id
    and team.submitted_by = target_user_id
    and team.status <> 'withdrawn'
  order by team.registered_at desc
  limit 1;

  return result;
end;
$$;

create or replace function public.save_my_tournament_registration(
  target_tournament_id uuid,
  payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid := auth.uid();
  target_club_id uuid;
  target_series_id uuid := nullif(payload->>'series_id', '')::uuid;
  target_team_id uuid;
  existing_team public.tournament_teams;
  current_profile public.profiles;
  submitter_role text := coalesce(payload->>'submitter_role', '');
  partner_role text;
  submitter_first_name text;
  submitter_last_name text;
  partner_first_name text := btrim(coalesce(payload->>'partner_first_name', ''));
  partner_last_name text := btrim(coalesce(payload->>'partner_last_name', ''));
  target_contact_email text;
  target_contact_phone text := btrim(coalesce(payload->>'contact_phone', ''));
  player_payload jsonb;
  availability_payload jsonb := coalesce(payload->'availability_rules', '[]'::jsonb);
begin
  if target_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select profile.*
  into current_profile
  from public.profiles as profile
  where profile.id = target_user_id;

  if current_profile.id is null then
    raise exception 'Profile required' using errcode = '42501';
  end if;

  select tournament.club_id
  into target_club_id
  from public.tournaments as tournament
  where tournament.id = target_tournament_id;

  if target_club_id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  perform public.sync_tournament_registration_states(target_club_id);

  if not public.tournament_registration_is_open(target_tournament_id) then
    raise exception 'Tournament registrations are closed' using errcode = 'P0001';
  end if;

  if target_series_id is null
    or not exists (
      select 1
      from public.tournament_series as series
      where series.id = target_series_id
        and series.tournament_id = target_tournament_id
        and series.enabled
    ) then
    raise exception 'Tournament series is invalid' using errcode = '22023';
  end if;

  select team.*
  into existing_team
  from public.tournament_teams as team
  where team.tournament_id = target_tournament_id
    and team.submitted_by = target_user_id
    and team.status <> 'withdrawn'
  order by team.registered_at desc
  limit 1
  for update;

  if not public.tournament_series_has_capacity(
    target_series_id,
    existing_team.id
  ) then
    raise exception 'Tournament series is full' using errcode = 'P0001';
  end if;

  if submitter_role not in ('front', 'back') then
    raise exception 'Tournament player role is invalid' using errcode = '22023';
  end if;
  partner_role := case when submitter_role = 'front' then 'back' else 'front' end;

  submitter_first_name := btrim(coalesce(
    nullif(current_profile.first_name, ''),
    payload->>'submitter_first_name',
    ''
  ));
  submitter_last_name := btrim(coalesce(
    nullif(current_profile.last_name, ''),
    payload->>'submitter_last_name',
    ''
  ));
  target_contact_email := btrim(coalesce(
    nullif(payload->>'contact_email', ''),
    current_profile.email,
    ''
  ));

  if submitter_first_name = ''
    or submitter_last_name = ''
    or partner_first_name = ''
    or partner_last_name = ''
    or target_contact_email = '' then
    raise exception 'Tournament registration fields are incomplete'
      using errcode = '22023';
  end if;

  if existing_team.id is null then
    insert into public.tournament_teams (
      tournament_id,
      series_id,
      status,
      contact_email,
      contact_phone,
      comments,
      submitted_by,
      created_by
    )
    values (
      target_tournament_id,
      target_series_id,
      'pending',
      target_contact_email,
      target_contact_phone,
      btrim(coalesce(payload->>'comments', '')),
      target_user_id,
      target_user_id
    )
    returning id into target_team_id;
  else
    target_team_id := existing_team.id;
    update public.tournament_teams
    set
      series_id = target_series_id,
      status = 'pending',
      contact_email = target_contact_email,
      contact_phone = target_contact_phone,
      comments = btrim(coalesce(payload->>'comments', '')),
      validated_by = null,
      validated_at = null,
      updated_at = now()
    where id = target_team_id;
  end if;

  player_payload := jsonb_build_array(
    jsonb_build_object(
      'member_id', current_profile.member_id,
      'role', submitter_role,
      'first_name', submitter_first_name,
      'last_name', submitter_last_name,
      'email', current_profile.email,
      'phone', ''
    ),
    jsonb_build_object(
      'member_id', null,
      'role', partner_role,
      'first_name', partner_first_name,
      'last_name', partner_last_name,
      'email', btrim(coalesce(payload->>'partner_email', '')),
      'phone', btrim(coalesce(payload->>'partner_phone', ''))
    )
  );

  perform public.save_tournament_team_children(
    target_team_id,
    target_tournament_id,
    target_club_id,
    player_payload,
    availability_payload
  );

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    target_tournament_id,
    case when existing_team.id is null then 'team_submitted' else 'team_resubmitted' end,
    (select status from public.tournaments where id = target_tournament_id),
    (select status from public.tournaments where id = target_tournament_id),
    jsonb_build_object('team_id', target_team_id, 'series_id', target_series_id),
    target_user_id
  );

  return target_team_id;
end;
$$;

create or replace function public.withdraw_my_tournament_registration(
  target_tournament_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid := auth.uid();
  target_team_id uuid;
  target_club_id uuid;
begin
  if target_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select tournament.club_id
  into target_club_id
  from public.tournaments as tournament
  where tournament.id = target_tournament_id;

  if target_club_id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  perform public.sync_tournament_registration_states(target_club_id);
  if not public.tournament_registration_is_open(target_tournament_id) then
    raise exception 'Tournament registrations are closed' using errcode = 'P0001';
  end if;

  update public.tournament_teams
  set status = 'withdrawn', updated_at = now()
  where tournament_id = target_tournament_id
    and submitted_by = target_user_id
    and status in ('pending', 'accepted', 'rejected')
  returning id into target_team_id;

  if target_team_id is null then
    raise exception 'Tournament registration not found' using errcode = 'P0002';
  end if;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    target_tournament_id,
    'team_withdrawn_by_user',
    (select status from public.tournaments where id = target_tournament_id),
    (select status from public.tournaments where id = target_tournament_id),
    jsonb_build_object('team_id', target_team_id),
    target_user_id
  );
end;
$$;

create or replace function public.admin_list_tournament_teams(target_tournament_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  result jsonb;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  perform public.sync_tournament_registration_states(target_club_id);

  select jsonb_build_object(
    'tournament', jsonb_build_object(
      'id', tournament.id,
      'name', tournament.name,
      'status', tournament.status,
      'registration_opens_at', tournament.registration_opens_at,
      'registration_closes_at', tournament.registration_closes_at
    ),
    'series', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', series.id,
            'name', series.name,
            'capacity', series.capacity,
            'enabled', series.enabled,
            'reserved_count', public.tournament_series_reserved_count(series.id, null),
            'accepted_count', (
              select count(*)
              from public.tournament_teams as accepted_team
              where accepted_team.series_id = series.id
                and accepted_team.status = 'accepted'
            )
          )
          order by series.display_order, series.name
        ),
        '[]'::jsonb
      )
      from public.tournament_series as series
      where series.tournament_id = tournament.id
    ),
    'teams', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', team.id,
            'series_id', team.series_id,
            'series_name', series.name,
            'status', team.status,
            'contact_email', team.contact_email,
            'contact_phone', team.contact_phone,
            'comments', team.comments,
            'submitted_by', team.submitted_by,
            'registered_at', team.registered_at,
            'updated_at', team.updated_at,
            'players', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'member_id', player.member_id,
                    'first_name', player.first_name,
                    'last_name', player.last_name,
                    'email', player.email,
                    'phone', player.phone,
                    'role', player.role
                  )
                  order by player.display_order
                ),
                '[]'::jsonb
              )
              from public.tournament_team_players as player
              where player.team_id = team.id
            ),
            'availability_rules', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'kind', rule.kind,
                    'weekday', rule.weekday,
                    'starts_at', rule.starts_at,
                    'ends_at', rule.ends_at
                  )
                  order by rule.display_order, rule.weekday, rule.starts_at
                ),
                '[]'::jsonb
              )
              from public.tournament_team_availability_rules as rule
              where rule.team_id = team.id
            )
          )
          order by series.display_order, team.registered_at, team.id
        ),
        '[]'::jsonb
      )
      from public.tournament_teams as team
      join public.tournament_series as series on series.id = team.series_id
      where team.tournament_id = tournament.id
    )
  )
  into result
  from public.tournaments as tournament
  where tournament.id = target_tournament_id
    and tournament.club_id = target_club_id;

  if result is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  return result;
end;
$$;

create or replace function public.admin_save_tournament_team(
  target_tournament_id uuid,
  target_team_id uuid,
  payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  current_tournament public.tournaments;
  current_team public.tournament_teams;
  target_series_id uuid := nullif(payload->>'series_id', '')::uuid;
  saved_team_id uuid;
  target_contact_email text := btrim(coalesce(payload->>'contact_email', ''));
  target_status text := coalesce(nullif(payload->>'status', ''), 'accepted');
  players jsonb := coalesce(payload->'players', '[]'::jsonb);
  availability_rules jsonb := coalesce(payload->'availability_rules', '[]'::jsonb);
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select tournament.*
  into current_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id
    and tournament.club_id = target_club_id
  for update;

  if current_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if current_tournament.status not in (
    'preparation',
    'configuration',
    'registrations_open',
    'registrations_closed'
  ) then
    raise exception 'Tournament teams are locked at this stage' using errcode = 'P0001';
  end if;

  if target_series_id is null
    or not exists (
      select 1
      from public.tournament_series as series
      where series.id = target_series_id
        and series.tournament_id = target_tournament_id
        and series.enabled
    ) then
    raise exception 'Tournament series is invalid' using errcode = '22023';
  end if;

  if target_contact_email = '' then
    raise exception 'Tournament registration fields are incomplete'
      using errcode = '22023';
  end if;

  if target_status not in ('pending', 'accepted') then
    raise exception 'Tournament team status is invalid' using errcode = '22023';
  end if;

  if target_team_id is not null then
    select team.*
    into current_team
    from public.tournament_teams as team
    where team.id = target_team_id
      and team.tournament_id = target_tournament_id
    for update;

    if current_team.id is null then
      raise exception 'Tournament team not found' using errcode = 'P0002';
    end if;
  end if;

  if target_status in ('pending', 'accepted')
    and not public.tournament_series_has_capacity(target_series_id, current_team.id) then
    raise exception 'Tournament series is full' using errcode = 'P0001';
  end if;

  if current_team.id is null then
    insert into public.tournament_teams (
      tournament_id,
      series_id,
      status,
      contact_email,
      contact_phone,
      comments,
      created_by,
      validated_by,
      validated_at
    )
    values (
      target_tournament_id,
      target_series_id,
      target_status::public.tournament_team_status,
      target_contact_email,
      btrim(coalesce(payload->>'contact_phone', '')),
      btrim(coalesce(payload->>'comments', '')),
      auth.uid(),
      case when target_status = 'accepted' then auth.uid() else null end,
      case when target_status = 'accepted' then now() else null end
    )
    returning id into saved_team_id;
  else
    saved_team_id := current_team.id;
    update public.tournament_teams
    set
      series_id = target_series_id,
      status = target_status::public.tournament_team_status,
      contact_email = target_contact_email,
      contact_phone = btrim(coalesce(payload->>'contact_phone', '')),
      comments = btrim(coalesce(payload->>'comments', '')),
      validated_by = case when target_status = 'accepted' then auth.uid() else null end,
      validated_at = case when target_status = 'accepted' then now() else null end,
      updated_at = now()
    where id = saved_team_id;
  end if;

  perform public.save_tournament_team_children(
    saved_team_id,
    target_tournament_id,
    target_club_id,
    players,
    availability_rules
  );

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    target_tournament_id,
    case when current_team.id is null then 'team_added_by_admin' else 'team_updated_by_admin' end,
    current_tournament.status,
    current_tournament.status,
    jsonb_build_object('team_id', saved_team_id, 'series_id', target_series_id),
    auth.uid()
  );

  return saved_team_id;
end;
$$;

create or replace function public.admin_set_tournament_team_status(
  target_team_id uuid,
  target_status public.tournament_team_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  current_team public.tournament_teams;
  current_tournament public.tournaments;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select team.*
  into current_team
  from public.tournament_teams as team
  join public.tournaments as tournament on tournament.id = team.tournament_id
  where team.id = target_team_id
    and tournament.club_id = target_club_id
  for update of team;

  if current_team.id is null then
    raise exception 'Tournament team not found' using errcode = 'P0002';
  end if;

  select tournament.*
  into current_tournament
  from public.tournaments as tournament
  where tournament.id = current_team.tournament_id
  for update;

  if current_tournament.status not in (
    'preparation',
    'configuration',
    'registrations_open',
    'registrations_closed'
  ) then
    raise exception 'Tournament teams are locked at this stage' using errcode = 'P0001';
  end if;

  if target_status = 'accepted'
    and current_team.status not in ('pending', 'accepted')
    and not public.tournament_series_has_capacity(current_team.series_id, current_team.id) then
    raise exception 'Tournament series is full' using errcode = 'P0001';
  end if;

  update public.tournament_teams
  set
    status = target_status,
    validated_by = case when target_status in ('accepted', 'rejected') then auth.uid() else null end,
    validated_at = case when target_status in ('accepted', 'rejected') then now() else null end,
    updated_at = now()
  where id = target_team_id;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    current_team.tournament_id,
    'team_status_changed',
    current_tournament.status,
    current_tournament.status,
    jsonb_build_object(
      'team_id', target_team_id,
      'from', current_team.status,
      'to', target_status
    ),
    auth.uid()
  );
end;
$$;

revoke all on function public.list_public_tournaments() from public;
revoke all on function public.get_public_tournament(uuid) from public;
revoke all on function public.get_my_tournament_registration(uuid) from public;
revoke all on function public.save_my_tournament_registration(uuid, jsonb) from public;
revoke all on function public.withdraw_my_tournament_registration(uuid) from public;
revoke all on function public.admin_list_tournament_teams(uuid) from public;
revoke all on function public.admin_save_tournament_team(uuid, uuid, jsonb) from public;
revoke all on function public.admin_set_tournament_team_status(uuid, public.tournament_team_status) from public;

grant execute on function public.list_public_tournaments() to anon, authenticated;
grant execute on function public.get_public_tournament(uuid) to anon, authenticated;
grant execute on function public.get_my_tournament_registration(uuid) to authenticated;
grant execute on function public.save_my_tournament_registration(uuid, jsonb) to authenticated;
grant execute on function public.withdraw_my_tournament_registration(uuid) to authenticated;
grant execute on function public.admin_list_tournament_teams(uuid) to authenticated;
grant execute on function public.admin_save_tournament_team(uuid, uuid, jsonb) to authenticated;
grant execute on function public.admin_set_tournament_team_status(uuid, public.tournament_team_status) to authenticated;

commit;
