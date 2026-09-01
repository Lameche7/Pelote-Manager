begin;

-- PR124 — Fondation de l'import de tournois externes (première source : Errebot).
--
-- Objectifs de cette migration :
-- 1. rendre le Pool Engine compatible avec les poules de 3 rencontrées dans
--    l'export Bizanos 2026, sans changer la préférence du générateur natif ;
-- 2. conserver la provenance et l'identifiant d'équipe du système source ;
-- 3. créer une identité externe réutilisable entre plusieurs tournois afin de
--    pouvoir rattacher un participant importé à un compte Pelote Manager déjà
--    existant ou créé ultérieurement ;
-- 4. ne jamais exposer directement les données importées : les futures écritures
--    et lectures passeront par des RPC dédiées.

-- ---------------------------------------------------------------------------
-- Pool Engine : les tournois importés peuvent contenir des poules de 3.
-- ---------------------------------------------------------------------------

alter table public.tournament_pools
  drop constraint if exists tournament_pools_target_size_check;

alter table public.tournament_pools
  add constraint tournament_pools_target_size_check
  check (target_size in (3, 4, 5, 6));

create or replace function public.tournament_pools_are_complete(
  target_tournament_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.tournaments as tournament
      where tournament.id = target_tournament_id
    )
    and not exists (
      select 1
      from public.tournament_pools as pool
      left join lateral (
        select count(*)::integer as team_count
        from public.tournament_pool_teams as assignment
        where assignment.pool_id = pool.id
      ) as stats on true
      where pool.tournament_id = target_tournament_id
        and (
          pool.target_size not in (3, 4, 5, 6)
          or stats.team_count <> pool.target_size
        )
    )
    and not exists (
      select 1
      from public.tournament_pool_teams as assignment
      join public.tournament_pools as pool on pool.id = assignment.pool_id
      join public.tournament_teams as team on team.id = assignment.team_id
      where pool.tournament_id = target_tournament_id
        and (
          team.tournament_id <> target_tournament_id
          or team.series_id <> pool.series_id
          or team.status <> 'accepted'
        )
    )
    and not exists (
      select 1
      from public.tournament_teams as team
      where team.tournament_id = target_tournament_id
        and team.status = 'accepted'
        and not exists (
          select 1
          from public.tournament_pool_teams as assignment
          join public.tournament_pools as pool on pool.id = assignment.pool_id
          where assignment.team_id = team.id
            and pool.tournament_id = target_tournament_id
        )
    )
    and not exists (
      select 1
      from public.tournament_pools as pool
      where pool.tournament_id = target_tournament_id
        and not exists (
          select 1
          from public.tournament_series as series
          where series.id = pool.series_id
            and series.tournament_id = target_tournament_id
            and series.enabled
        )
    );
$$;

revoke all on function public.tournament_pools_are_complete(uuid)
from public, anon, authenticated;

-- Même point d'entrée qu'aujourd'hui afin que les poules de 3 restent éditables
-- dans le back-office après l'import.
create or replace function public.admin_save_tournament_pools(
  target_tournament_id uuid,
  payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_tournament public.tournaments;
  pool_values jsonb := coalesce(payload->'pools', '[]'::jsonb);
  pool_item jsonb;
  team_item jsonb;
  target_series_id uuid;
  target_team_id uuid;
  target_display_order integer;
  target_size integer;
  target_pool_id uuid;
  target_team_display_order integer;
  accepted_count integer;
  assigned_count integer := 0;
  seen_team_ids uuid[] := '{}'::uuid[];
  seen_pool_keys text[] := '{}'::text[];
  pool_key text;
  previous_status public.tournament_status;
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

  if target_tournament.status not in ('registrations_closed', 'pools_generated') then
    raise exception 'Tournament pools are not editable at this stage'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.tournament_teams as team
    where team.tournament_id = target_tournament.id
      and team.status = 'pending'
  ) then
    raise exception 'Pending tournament teams must be resolved before pool generation'
      using errcode = 'P0001';
  end if;

  if jsonb_typeof(pool_values) <> 'array' then
    raise exception 'Tournament pool payload is invalid' using errcode = '22023';
  end if;

  select count(*)::integer
  into accepted_count
  from public.tournament_teams as team
  where team.tournament_id = target_tournament.id
    and team.status = 'accepted';

  for pool_item in
    select value from jsonb_array_elements(pool_values)
  loop
    target_series_id := nullif(pool_item->>'series_id', '')::uuid;
    target_display_order := nullif(pool_item->>'display_order', '')::integer;
    target_size := nullif(pool_item->>'target_size', '')::integer;

    if target_series_id is null
      or target_display_order is null
      or target_display_order < 0
      or target_size not in (3, 4, 5, 6)
      or jsonb_typeof(coalesce(pool_item->'teams', '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(pool_item->'teams', '[]'::jsonb)) <> target_size then
      raise exception 'Tournament pool payload is invalid' using errcode = '22023';
    end if;

    if not exists (
      select 1
      from public.tournament_series as series
      where series.id = target_series_id
        and series.tournament_id = target_tournament.id
        and series.enabled
    ) then
      raise exception 'Tournament pool series is invalid' using errcode = '22023';
    end if;

    pool_key := concat(target_series_id, '|', target_display_order);
    if pool_key = any(seen_pool_keys) then
      raise exception 'Tournament pool payload is invalid' using errcode = '22023';
    end if;
    seen_pool_keys := array_append(seen_pool_keys, pool_key);

    for team_item in
      select value from jsonb_array_elements(pool_item->'teams')
    loop
      target_team_id := nullif(team_item->>'team_id', '')::uuid;

      if target_team_id is null
        or target_team_id = any(seen_team_ids)
        or not exists (
          select 1
          from public.tournament_teams as team
          where team.id = target_team_id
            and team.tournament_id = target_tournament.id
            and team.series_id = target_series_id
            and team.status = 'accepted'
        ) then
        raise exception 'Tournament pool team is invalid' using errcode = '22023';
      end if;

      seen_team_ids := array_append(seen_team_ids, target_team_id);
      assigned_count := assigned_count + 1;
    end loop;
  end loop;

  if assigned_count <> accepted_count then
    raise exception 'Every accepted team must belong to exactly one pool'
      using errcode = '22023';
  end if;

  delete from public.tournament_pools
  where tournament_id = target_tournament.id;

  for pool_item in
    select value from jsonb_array_elements(pool_values)
  loop
    target_series_id := (pool_item->>'series_id')::uuid;
    target_display_order := (pool_item->>'display_order')::integer;
    target_size := (pool_item->>'target_size')::integer;

    insert into public.tournament_pools (
      tournament_id,
      series_id,
      display_order,
      target_size,
      updated_at
    )
    values (
      target_tournament.id,
      target_series_id,
      target_display_order,
      target_size,
      now()
    )
    returning id into target_pool_id;

    target_team_display_order := 0;
    for team_item in
      select value from jsonb_array_elements(pool_item->'teams')
    loop
      insert into public.tournament_pool_teams (
        pool_id,
        team_id,
        display_order
      )
      values (
        target_pool_id,
        (team_item->>'team_id')::uuid,
        coalesce(
          nullif(team_item->>'display_order', '')::integer,
          target_team_display_order
        )
      );

      target_team_display_order := target_team_display_order + 1;
    end loop;
  end loop;

  if accepted_count > 0 and not public.tournament_pools_are_complete(target_tournament.id) then
    raise exception 'Tournament pools are incomplete' using errcode = 'P0001';
  end if;

  previous_status := target_tournament.status;

  update public.tournaments
  set
    status = 'pools_generated',
    updated_by = auth.uid(),
    updated_at = now()
  where id = target_tournament.id;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    target_tournament.id,
    case
      when previous_status = 'registrations_closed' then 'pools_generated'
      else 'pools_updated'
    end,
    previous_status,
    'pools_generated',
    jsonb_build_object(
      'pool_count', jsonb_array_length(pool_values),
      'team_count', assigned_count
    ),
    auth.uid()
  );
end;
$$;

revoke all on function public.admin_save_tournament_pools(uuid, jsonb)
from public, anon;
grant execute on function public.admin_save_tournament_pools(uuid, jsonb)
to authenticated;

-- ---------------------------------------------------------------------------
-- Import : provenance du fichier et correspondances avec les objets natifs.
-- ---------------------------------------------------------------------------

create table public.tournament_imports (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  tournament_id uuid references public.tournaments (id) on delete cascade,
  source text not null default 'errebot' check (btrim(source) <> ''),
  source_file_name text not null check (btrim(source_file_name) <> ''),
  source_file_size bigint not null default 0 check (source_file_size >= 0),
  source_file_hash text not null check (btrim(source_file_hash) <> ''),
  parser_version text not null default 'errebot-pdf-v1'
    check (btrim(parser_version) <> ''),
  status text not null default 'draft'
    check (status in ('draft', 'validated', 'imported', 'failed', 'cancelled')),
  summary jsonb not null default '{}'::jsonb,
  error_message text,
  created_by uuid references public.profiles (id) on delete set null
    default auth.uid(),
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  imported_at timestamptz,
  unique (club_id, source, source_file_hash)
);

create index tournament_imports_club_created_idx
on public.tournament_imports (club_id, created_at desc);

create index tournament_imports_tournament_idx
on public.tournament_imports (tournament_id)
where tournament_id is not null;

-- ---------------------------------------------------------------------------
-- Identité externe.
--
-- Un numéro de téléphone n'est jamais une preuve d'identité à lui seul.
-- Le triplet normalisé prénom + nom + téléphone sert uniquement à retrouver la
-- même identité externe. Le statut verified ne pourra être posé que par un futur
-- RPC de vérification (licencié déjà lié, OTP, ou validation contrôlée).
-- ---------------------------------------------------------------------------

create or replace function public.normalize_tournament_phone(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  with cleaned as (
    select regexp_replace(coalesce(value, ''), '[^0-9]+', '', 'g') as digits
  )
  select case
    when digits = '' then ''
    when digits ~ '^0033[0-9]{9}$' then '+33' || substring(digits from 5)
    when digits ~ '^33[0-9]{9}$' then '+33' || substring(digits from 3)
    when digits ~ '^0[0-9]{9}$' then '+33' || substring(digits from 2)
    else '+' || digits
  end
  from cleaned;
$$;

revoke all on function public.normalize_tournament_phone(text)
from public, anon, authenticated;

create table public.tournament_external_player_identities (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'errebot' check (btrim(source) <> ''),
  first_name text not null check (btrim(first_name) <> ''),
  last_name text not null check (btrim(last_name) <> ''),
  phone text not null default '',
  first_name_normalized text not null,
  last_name_normalized text not null,
  phone_normalized text not null default '',
  profile_id uuid references public.profiles (id) on delete set null,
  member_id uuid references public.club_members (id) on delete set null,
  status text not null default 'unmatched'
    check (status in ('unmatched', 'suggested', 'verified', 'conflict')),
  verification_method text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    status <> 'verified'
    or (profile_id is not null and verified_at is not null)
  )
);

create unique index tournament_external_identity_exact_phone_unique
on public.tournament_external_player_identities (
  source,
  last_name_normalized,
  first_name_normalized,
  phone_normalized
)
where phone_normalized <> '';

create index tournament_external_identity_profile_idx
on public.tournament_external_player_identities (profile_id)
where profile_id is not null;

create index tournament_external_identity_member_idx
on public.tournament_external_player_identities (member_id)
where member_id is not null;

create or replace function public.sync_tournament_external_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.source := lower(btrim(new.source));
  new.first_name := btrim(new.first_name);
  new.last_name := btrim(new.last_name);
  new.phone := btrim(coalesce(new.phone, ''));
  new.first_name_normalized := public.normalize_member_identity(new.first_name);
  new.last_name_normalized := public.normalize_member_identity(new.last_name);
  new.phone_normalized := public.normalize_tournament_phone(new.phone);
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.sync_tournament_external_identity()
from public, anon, authenticated;

create trigger sync_tournament_external_identity_before_write
before insert or update of source, first_name, last_name, phone
on public.tournament_external_player_identities
for each row execute function public.sync_tournament_external_identity();

alter table public.tournament_team_players
add column if not exists external_identity_id uuid
references public.tournament_external_player_identities (id)
on delete set null;

create index tournament_team_players_external_identity_idx
on public.tournament_team_players (external_identity_id)
where external_identity_id is not null;

create table public.tournament_import_team_refs (
  import_id uuid not null
    references public.tournament_imports (id) on delete cascade,
  team_id uuid not null
    references public.tournament_teams (id) on delete cascade,
  external_team_id text not null check (btrim(external_team_id) <> ''),
  created_at timestamptz not null default now(),
  primary key (import_id, team_id),
  unique (import_id, external_team_id),
  unique (team_id)
);

-- Les tables contiennent des données personnelles importées. Elles sont privées
-- par défaut ; les futures interfaces utiliseront uniquement des SECURITY DEFINER
-- contrôlés par tournaments.manage ou par le propriétaire du compte.
alter table public.tournament_imports enable row level security;
alter table public.tournament_external_player_identities enable row level security;
alter table public.tournament_import_team_refs enable row level security;

revoke all on table public.tournament_imports
from public, anon, authenticated;
revoke all on table public.tournament_external_player_identities
from public, anon, authenticated;
revoke all on table public.tournament_import_team_refs
from public, anon, authenticated;

comment on table public.tournament_imports is
  'Trace un fichier de tournoi externe converti vers le moteur natif Pelote Manager.';
comment on table public.tournament_external_player_identities is
  'Identité externe réutilisable entre imports ; un téléphone exact n''est pas à lui seul une preuve de propriété du compte.';
comment on column public.tournament_team_players.external_identity_id is
  'Identité externe d''origine pour un participant issu d''un import de tournoi.';
comment on table public.tournament_import_team_refs is
  'Conserve l''identifiant d''équipe du système source (ex. 215 dans Errebot) après conversion vers tournament_teams.';

commit;
