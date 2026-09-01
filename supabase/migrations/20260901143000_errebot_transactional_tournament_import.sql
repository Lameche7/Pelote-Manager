begin;

-- PR125 — Conversion transactionnelle d'un tournoi Errebot vers le moteur natif.
-- Le PDF et son texte ne sont jamais persistés : seul le payload structuré validé
-- côté serveur est converti. Toute erreur fait échouer l'appel RPC complet.

create table public.tournament_import_pool_refs (
  import_id uuid not null
    references public.tournament_imports (id) on delete cascade,
  pool_id uuid not null
    references public.tournament_pools (id) on delete cascade,
  series_name text not null check (btrim(series_name) <> ''),
  external_pool_name text not null check (btrim(external_pool_name) <> ''),
  created_at timestamptz not null default now(),
  primary key (import_id, pool_id),
  unique (import_id, series_name, external_pool_name),
  unique (pool_id)
);

create table public.tournament_import_fixture_refs (
  import_id uuid not null
    references public.tournament_imports (id) on delete cascade,
  match_id uuid not null
    references public.tournament_matches (id) on delete cascade,
  series_name text not null check (btrim(series_name) <> ''),
  external_pool_name text not null check (btrim(external_pool_name) <> ''),
  team_a_external_id text not null check (btrim(team_a_external_id) <> ''),
  team_b_external_id text not null check (btrim(team_b_external_id) <> ''),
  play_date date not null,
  starts_at time not null,
  source_score_a integer check (source_score_a is null or source_score_a >= 0),
  source_score_b integer check (source_score_b is null or source_score_b >= 0),
  created_at timestamptz not null default now(),
  primary key (import_id, match_id),
  unique (match_id)
);

alter table public.tournament_import_pool_refs enable row level security;
alter table public.tournament_import_fixture_refs enable row level security;

revoke all on table public.tournament_import_pool_refs
from public, anon, authenticated;
revoke all on table public.tournament_import_fixture_refs
from public, anon, authenticated;

comment on table public.tournament_import_pool_refs is
  'Correspondance privée entre une poule native et son nom de poule dans le système source.';
comment on table public.tournament_import_fixture_refs is
  'Provenance privée des matchs importés. Les scores Errebot simples sont conservés sans être inventés comme manches natives.';

create or replace function public.admin_import_errebot_tournament(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_profile_id uuid := auth.uid();
  input_file jsonb := coalesce(payload->'file', '{}'::jsonb);
  input_tournament jsonb := coalesce(payload->'tournament', '{}'::jsonb);
  input_series jsonb := coalesce(payload->'series', '[]'::jsonb);
  input_teams jsonb := coalesce(payload->'teams', '[]'::jsonb);
  input_pools jsonb := coalesce(payload->'pools', '[]'::jsonb);
  input_fixtures jsonb := coalesce(payload->'fixtures', '[]'::jsonb);
  input_file_name text := btrim(coalesce(input_file->>'name', ''));
  input_file_hash text := lower(btrim(coalesce(input_file->>'hash', '')));
  input_file_size bigint := coalesce(nullif(input_file->>'size', '')::bigint, 0);
  input_parser_version text := btrim(coalesce(input_file->>'parserVersion', ''));
  input_name text := btrim(coalesce(input_tournament->>'name', ''));
  input_season_id uuid := nullif(input_tournament->>'seasonId', '')::uuid;
  input_resource_id uuid := nullif(input_tournament->>'resourceId', '')::uuid;
  input_slot_duration integer := coalesce(
    nullif(input_tournament->>'slotDurationMinutes', '')::integer,
    60
  );
  target_start_date date;
  target_end_date date;
  target_import_id uuid;
  target_tournament_id uuid;
  target_series_id uuid;
  target_team_id uuid;
  target_pool_id uuid;
  target_match_id uuid;
  target_external_identity public.tournament_external_player_identities;
  target_member_id uuid;
  target_player_club_name text;
  item_series jsonb;
  item_team jsonb;
  item_player jsonb;
  item_pool jsonb;
  item_team_ref jsonb;
  item_fixture jsonb;
  item_external_id text;
  item_series_name text;
  item_pool_name text;
  item_team_a_external_id text;
  item_team_b_external_id text;
  item_play_date date;
  item_start_time time;
  item_end_time time;
  item_score_a integer;
  item_score_b integer;
  item_display_order integer;
  item_player_index integer;
  item_first_name text;
  item_last_name text;
  item_phone text;
  existing_import public.tournament_imports;
  team_count integer;
  pool_count integer;
  fixture_count integer;
  expected_fixture_count integer;
  verified_player_count integer;
  external_player_count integer;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if jsonb_typeof(input_series) <> 'array'
    or jsonb_typeof(input_teams) <> 'array'
    or jsonb_typeof(input_pools) <> 'array'
    or jsonb_typeof(input_fixtures) <> 'array' then
    raise exception 'Errebot import payload is invalid' using errcode = '22023';
  end if;

  team_count := jsonb_array_length(input_teams);
  pool_count := jsonb_array_length(input_pools);
  fixture_count := jsonb_array_length(input_fixtures);

  if input_file_name = ''
    or input_file_size <= 0
    or input_file_hash !~ '^[0-9a-f]{64}$'
    or input_parser_version <> 'errebot-pdf-v1'
    or input_name = ''
    or length(input_name) > 160
    or input_season_id is null
    or input_resource_id is null
    or input_slot_duration < 15
    or input_slot_duration > 240
    or team_count < 2
    or team_count > 500
    or pool_count < 1
    or pool_count > 200
    or fixture_count < 1
    or fixture_count > 2000
    or jsonb_array_length(input_series) < 1
    or jsonb_array_length(input_series) > 20 then
    raise exception 'Errebot import payload is invalid' using errcode = '22023';
  end if;

  select import_row.*
  into existing_import
  from public.tournament_imports as import_row
  where import_row.club_id = target_club_id
    and import_row.source = 'errebot'
    and import_row.source_file_hash = input_file_hash
  for update;

  if existing_import.id is not null then
    if existing_import.status = 'imported'
      and existing_import.tournament_id is not null then
      return jsonb_build_object(
        'importId', existing_import.id,
        'tournamentId', existing_import.tournament_id,
        'alreadyImported', true,
        'summary', existing_import.summary
      );
    end if;

    raise exception 'This Errebot file already has an unfinished import'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.club_seasons as season
    where season.id = input_season_id
      and season.club_id = target_club_id
  ) then
    raise exception 'Errebot import season is invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.reservable_resources as resource
    where resource.id = input_resource_id
      and resource.club_id = target_club_id
      and resource.is_active
  ) then
    raise exception 'Errebot import resource is invalid' using errcode = '22023';
  end if;

  -- Séries uniques, nommées et réellement utilisées par les équipes.
  if exists (
    select 1
    from jsonb_array_elements(input_series) as series_item(value)
    where btrim(coalesce(series_item.value->>'name', '')) = ''
  ) or (
    select count(*)
    from (
      select btrim(series_item.value->>'name')
      from jsonb_array_elements(input_series) as series_item(value)
      group by btrim(series_item.value->>'name')
    ) as unique_series
  ) <> jsonb_array_length(input_series) then
    raise exception 'Errebot series are invalid' using errcode = '22023';
  end if;

  -- Équipes uniques, deux joueurs exactement et série connue.
  if exists (
    select 1
    from jsonb_array_elements(input_teams) as team_item(value)
    where btrim(coalesce(team_item.value->>'externalId', '')) = ''
      or btrim(coalesce(team_item.value->>'series', '')) = ''
      or jsonb_typeof(coalesce(team_item.value->'players', '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(team_item.value->'players', '[]'::jsonb)) <> 2
      or not exists (
        select 1
        from jsonb_array_elements(input_series) as series_item(value)
        where btrim(series_item.value->>'name') = btrim(team_item.value->>'series')
      )
  ) or (
    select count(distinct btrim(team_item.value->>'externalId'))
    from jsonb_array_elements(input_teams) as team_item(value)
  ) <> team_count or exists (
    select 1
    from jsonb_array_elements(input_teams) as team_item(value)
    cross join lateral jsonb_array_elements(team_item.value->'players') as player_item(value)
    where btrim(coalesce(player_item.value->>'firstName', '')) = ''
      or btrim(coalesce(player_item.value->>'lastName', '')) = ''
      or length(btrim(coalesce(player_item.value->>'phone', ''))) < 8
  ) then
    raise exception 'Errebot teams are invalid' using errcode = '22023';
  end if;

  -- Chaque équipe doit apparaître une fois et une seule dans une poule de sa série.
  if exists (
    select 1
    from jsonb_array_elements(input_pools) as pool_item(value)
    where btrim(coalesce(pool_item.value->>'series', '')) = ''
      or btrim(coalesce(pool_item.value->>'name', '')) = ''
      or jsonb_typeof(coalesce(pool_item.value->'teamExternalIds', '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(pool_item.value->'teamExternalIds', '[]'::jsonb)) not between 3 and 6
  ) or (
    select count(*)
    from jsonb_array_elements(input_pools) as pool_item(value)
    cross join lateral jsonb_array_elements_text(pool_item.value->'teamExternalIds') as team_ref(value)
  ) <> team_count or (
    select count(distinct btrim(team_ref.value))
    from jsonb_array_elements(input_pools) as pool_item(value)
    cross join lateral jsonb_array_elements_text(pool_item.value->'teamExternalIds') as team_ref(value)
  ) <> team_count or exists (
    select 1
    from jsonb_array_elements(input_pools) as pool_item(value)
    cross join lateral jsonb_array_elements_text(pool_item.value->'teamExternalIds') as team_ref(value)
    where not exists (
      select 1
      from jsonb_array_elements(input_teams) as team_item(value)
      where btrim(team_item.value->>'externalId') = btrim(team_ref.value)
        and btrim(team_item.value->>'series') = btrim(pool_item.value->>'series')
    )
  ) then
    raise exception 'Errebot pool assignments are invalid' using errcode = '22023';
  end if;

  select coalesce(sum(
    jsonb_array_length(pool_item.value->'teamExternalIds')
      * (jsonb_array_length(pool_item.value->'teamExternalIds') - 1) / 2
  ), 0)::integer
  into expected_fixture_count
  from jsonb_array_elements(input_pools) as pool_item(value);

  -- Tous les matchs doivent appartenir à la poule annoncée et chaque paire ne
  -- peut apparaître qu'une fois. Avec le nombre attendu, cela garantit le round-robin complet.
  if expected_fixture_count <> fixture_count or exists (
    select 1
    from jsonb_array_elements(input_fixtures) as fixture_item(value)
    where nullif(fixture_item.value->>'date', '')::date is null
      or nullif(fixture_item.value->>'time', '')::time is null
      or btrim(coalesce(fixture_item.value->>'team1ExternalId', '')) = ''
      or btrim(coalesce(fixture_item.value->>'team2ExternalId', '')) = ''
      or fixture_item.value->>'team1ExternalId' = fixture_item.value->>'team2ExternalId'
      or not exists (
        select 1
        from jsonb_array_elements(input_pools) as pool_item(value)
        where btrim(pool_item.value->>'series') = btrim(fixture_item.value->>'series')
          and btrim(pool_item.value->>'name') = btrim(fixture_item.value->>'pool')
          and (pool_item.value->'teamExternalIds') ? btrim(fixture_item.value->>'team1ExternalId')
          and (pool_item.value->'teamExternalIds') ? btrim(fixture_item.value->>'team2ExternalId')
      )
  ) or exists (
    select 1
    from (
      select
        btrim(fixture_item.value->>'series') as series_name,
        btrim(fixture_item.value->>'pool') as pool_name,
        least(
          btrim(fixture_item.value->>'team1ExternalId'),
          btrim(fixture_item.value->>'team2ExternalId')
        ) as left_team,
        greatest(
          btrim(fixture_item.value->>'team1ExternalId'),
          btrim(fixture_item.value->>'team2ExternalId')
        ) as right_team,
        count(*) as occurrence_count
      from jsonb_array_elements(input_fixtures) as fixture_item(value)
      group by 1, 2, 3, 4
    ) as pairings
    where pairings.occurrence_count <> 1
  ) then
    raise exception 'Errebot fixtures are invalid' using errcode = '22023';
  end if;

  select min((fixture_item.value->>'date')::date),
         max((fixture_item.value->>'date')::date)
  into target_start_date, target_end_date
  from jsonb_array_elements(input_fixtures) as fixture_item(value);

  if not exists (
    select 1
    from public.club_seasons as season
    where season.id = input_season_id
      and season.club_id = target_club_id
      and season.starts_on <= target_start_date
      and season.ends_on >= target_end_date
  ) then
    raise exception 'Errebot tournament dates do not fit inside the selected season'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.tournaments as tournament
    where tournament.club_id = target_club_id
      and tournament.season_id = input_season_id
      and lower(btrim(tournament.name)) = lower(input_name)
  ) then
    raise exception 'Tournament name already exists' using errcode = '23505';
  end if;

  -- Aucun horaire ne doit déborder sur le jour suivant avec le modèle natif time/time.
  if exists (
    select 1
    from jsonb_array_elements(input_fixtures) as fixture_item(value)
    where ((fixture_item.value->>'time')::time + make_interval(mins => input_slot_duration))::time
      <= (fixture_item.value->>'time')::time
  ) then
    raise exception 'Errebot fixture duration crosses midnight' using errcode = '22023';
  end if;

  insert into public.tournament_imports (
    club_id,
    source,
    source_file_name,
    source_file_size,
    source_file_hash,
    parser_version,
    status,
    summary,
    created_by,
    validated_at
  )
  values (
    target_club_id,
    'errebot',
    input_file_name,
    input_file_size,
    input_file_hash,
    input_parser_version,
    'validated',
    jsonb_build_object(
      'teamCount', team_count,
      'poolCount', pool_count,
      'matchCount', fixture_count
    ),
    target_profile_id,
    now()
  )
  returning id into target_import_id;

  insert into public.tournaments (
    club_id,
    season_id,
    name,
    description,
    rules,
    starts_on,
    ends_on,
    pool_starts_on,
    pool_ends_on,
    finals_starts_on,
    finals_ends_on,
    registration_opens_at,
    registration_closes_at,
    status,
    timezone,
    slot_duration_minutes,
    created_by,
    updated_by
  )
  values (
    target_club_id,
    input_season_id,
    input_name,
    'Tournoi importé depuis Errebot.',
    'Structure, équipes, poules et planning importés depuis Errebot. Les scores source simples sont conservés comme provenance sans conversion automatique en manches.',
    target_start_date,
    target_end_date,
    target_start_date,
    target_end_date,
    null,
    null,
    (target_start_date::timestamp - interval '2 days') at time zone 'Europe/Paris',
    (target_start_date::timestamp - interval '1 day') at time zone 'Europe/Paris',
    'preparation',
    'Europe/Paris',
    input_slot_duration,
    target_profile_id,
    target_profile_id
  )
  returning id into target_tournament_id;

  update public.tournament_imports
  set tournament_id = target_tournament_id
  where id = target_import_id;

  insert into public.tournament_resources (
    tournament_id,
    resource_id,
    display_order
  )
  values (target_tournament_id, input_resource_id, 0);

  -- Une fenêtre exacte par jour de semaine / heure source. Cela rend le tournoi
  -- cohérent avec les outils natifs sans élargir arbitrairement le planning importé.
  insert into public.tournament_play_windows (
    tournament_id,
    weekday,
    opens_at,
    closes_at,
    display_order
  )
  select
    target_tournament_id,
    source_slot.weekday,
    source_slot.starts_at,
    (source_slot.starts_at + make_interval(mins => input_slot_duration))::time,
    row_number() over (order by source_slot.weekday, source_slot.starts_at)::integer - 1
  from (
    select distinct
      extract(dow from (fixture_item.value->>'date')::date)::smallint as weekday,
      (fixture_item.value->>'time')::time as starts_at
    from jsonb_array_elements(input_fixtures) as fixture_item(value)
  ) as source_slot
  order by source_slot.weekday, source_slot.starts_at;

  item_display_order := 0;
  for item_series in
    select value from jsonb_array_elements(input_series)
  loop
    item_series_name := btrim(item_series->>'name');

    insert into public.tournament_series (
      tournament_id,
      name,
      display_order,
      capacity,
      enabled
    )
    values (
      target_tournament_id,
      item_series_name,
      item_display_order,
      (
        select count(*)::integer
        from jsonb_array_elements(input_teams) as team_item(value)
        where btrim(team_item.value->>'series') = item_series_name
      ),
      true
    );

    item_display_order := item_display_order + 1;
  end loop;

  for item_team in
    select value from jsonb_array_elements(input_teams)
  loop
    item_external_id := btrim(item_team->>'externalId');
    item_series_name := btrim(item_team->>'series');

    select series.id
    into target_series_id
    from public.tournament_series as series
    where series.tournament_id = target_tournament_id
      and series.name = item_series_name;

    insert into public.tournament_teams (
      tournament_id,
      series_id,
      status,
      contact_email,
      contact_phone,
      comments,
      submitted_by,
      created_by,
      validated_by,
      validated_at,
      updated_at
    )
    values (
      target_tournament_id,
      target_series_id,
      'accepted',
      'errebot-' || regexp_replace(lower(item_external_id), '[^a-z0-9]+', '-', 'g') || '@pelote-manager.invalid',
      '',
      'Import Errebot · équipe #' || item_external_id,
      null,
      target_profile_id,
      target_profile_id,
      now(),
      now()
    )
    returning id into target_team_id;

    insert into public.tournament_import_team_refs (
      import_id,
      team_id,
      external_team_id
    )
    values (target_import_id, target_team_id, item_external_id);

    item_player_index := 0;
    for item_player in
      select value from jsonb_array_elements(item_team->'players')
    loop
      item_player_index := item_player_index + 1;
      item_first_name := btrim(item_player->>'firstName');
      item_last_name := btrim(item_player->>'lastName');
      item_phone := btrim(item_player->>'phone');

      target_external_identity.id := null;
      select external_identity.*
      into target_external_identity
      from public.tournament_external_player_identities as external_identity
      where external_identity.source = 'errebot'
        and external_identity.first_name_normalized = public.normalize_member_identity(item_first_name)
        and external_identity.last_name_normalized = public.normalize_member_identity(item_last_name)
        and external_identity.phone_normalized = public.normalize_tournament_phone(item_phone)
      order by
        case when external_identity.status = 'verified' then 0 else 1 end,
        external_identity.updated_at desc,
        external_identity.id
      limit 1
      for update;

      if target_external_identity.id is null then
        insert into public.tournament_external_player_identities (
          source,
          first_name,
          last_name,
          phone,
          status
        )
        values (
          'errebot',
          item_first_name,
          item_last_name,
          item_phone,
          'unmatched'
        )
        returning * into target_external_identity;
      end if;

      target_member_id := null;
      target_player_club_name := 'Externe (Errebot)';

      if target_external_identity.status = 'verified'
        and target_external_identity.member_id is not null then
        select member.id, club.name
        into target_member_id, target_player_club_name
        from public.club_members as member
        join public.clubs as club on club.id = member.club_id
        where member.id = target_external_identity.member_id
          and member.is_active;
      end if;

      insert into public.tournament_team_players (
        team_id,
        tournament_id,
        member_id,
        role,
        first_name,
        last_name,
        email,
        phone,
        display_order,
        club_name,
        external_identity_id
      )
      values (
        target_team_id,
        target_tournament_id,
        target_member_id,
        case
          when item_player_index = 1 then 'front'::public.tournament_player_role
          else 'back'::public.tournament_player_role
        end,
        item_first_name,
        item_last_name,
        '',
        item_phone,
        item_player_index - 1,
        coalesce(nullif(target_player_club_name, ''), 'Externe (Errebot)'),
        target_external_identity.id
      );
    end loop;
  end loop;

  if exists (
    select 1
    from public.tournament_team_players as player
    where player.tournament_id = target_tournament_id
      and player.member_id is not null
    group by player.member_id
    having count(distinct player.team_id) > 1
  ) then
    raise exception 'A verified member appears in more than one imported team'
      using errcode = '23505';
  end if;

  for item_pool in
    select value from jsonb_array_elements(input_pools)
  loop
    item_series_name := btrim(item_pool->>'series');
    item_pool_name := btrim(item_pool->>'name');

    select series.id
    into target_series_id
    from public.tournament_series as series
    where series.tournament_id = target_tournament_id
      and series.name = item_series_name;

    select count(*)::integer
    into item_display_order
    from public.tournament_pools as pool
    where pool.tournament_id = target_tournament_id
      and pool.series_id = target_series_id;

    insert into public.tournament_pools (
      tournament_id,
      series_id,
      display_order,
      target_size,
      updated_at
    )
    values (
      target_tournament_id,
      target_series_id,
      item_display_order,
      jsonb_array_length(item_pool->'teamExternalIds'),
      now()
    )
    returning id into target_pool_id;

    insert into public.tournament_import_pool_refs (
      import_id,
      pool_id,
      series_name,
      external_pool_name
    )
    values (
      target_import_id,
      target_pool_id,
      item_series_name,
      item_pool_name
    );

    item_display_order := 0;
    for item_team_ref in
      select to_jsonb(value) from jsonb_array_elements_text(item_pool->'teamExternalIds')
    loop
      item_external_id := trim(both '"' from item_team_ref::text);

      select team_ref.team_id
      into target_team_id
      from public.tournament_import_team_refs as team_ref
      where team_ref.import_id = target_import_id
        and team_ref.external_team_id = item_external_id;

      insert into public.tournament_pool_teams (
        pool_id,
        team_id,
        display_order
      )
      values (target_pool_id, target_team_id, item_display_order);

      item_display_order := item_display_order + 1;
    end loop;
  end loop;

  if not public.tournament_pools_are_complete(target_tournament_id) then
    raise exception 'Imported tournament pools are incomplete' using errcode = 'P0001';
  end if;

  for item_fixture in
    select value from jsonb_array_elements(input_fixtures)
  loop
    item_series_name := btrim(item_fixture->>'series');
    item_pool_name := btrim(item_fixture->>'pool');
    item_team_a_external_id := btrim(item_fixture->>'team1ExternalId');
    item_team_b_external_id := btrim(item_fixture->>'team2ExternalId');
    item_play_date := (item_fixture->>'date')::date;
    item_start_time := (item_fixture->>'time')::time;
    item_end_time := (item_start_time + make_interval(mins => input_slot_duration))::time;
    item_score_a := nullif(item_fixture->>'score1', '')::integer;
    item_score_b := nullif(item_fixture->>'score2', '')::integer;

    select pool_ref.pool_id, pool.series_id
    into target_pool_id, target_series_id
    from public.tournament_import_pool_refs as pool_ref
    join public.tournament_pools as pool on pool.id = pool_ref.pool_id
    where pool_ref.import_id = target_import_id
      and pool_ref.series_name = item_series_name
      and pool_ref.external_pool_name = item_pool_name;

    select team_ref.team_id
    into target_team_id
    from public.tournament_import_team_refs as team_ref
    where team_ref.import_id = target_import_id
      and team_ref.external_team_id = item_team_a_external_id;

    select count(*)::integer
    into item_display_order
    from public.tournament_matches as match
    where match.pool_id = target_pool_id;

    insert into public.tournament_matches (
      tournament_id,
      pool_id,
      series_id,
      team_a_id,
      team_b_id,
      display_order,
      status,
      updated_at
    )
    values (
      target_tournament_id,
      target_pool_id,
      target_series_id,
      target_team_id,
      (
        select team_ref.team_id
        from public.tournament_import_team_refs as team_ref
        where team_ref.import_id = target_import_id
          and team_ref.external_team_id = item_team_b_external_id
      ),
      item_display_order,
      'scheduled',
      now()
    )
    returning id into target_match_id;

    insert into public.tournament_match_planning (
      match_id,
      tournament_id,
      resource_id,
      play_date,
      starts_at,
      ends_at,
      source,
      updated_at
    )
    values (
      target_match_id,
      target_tournament_id,
      input_resource_id,
      item_play_date,
      item_start_time,
      item_end_time,
      'manual',
      now()
    );

    insert into public.tournament_import_fixture_refs (
      import_id,
      match_id,
      series_name,
      external_pool_name,
      team_a_external_id,
      team_b_external_id,
      play_date,
      starts_at,
      source_score_a,
      source_score_b
    )
    values (
      target_import_id,
      target_match_id,
      item_series_name,
      item_pool_name,
      item_team_a_external_id,
      item_team_b_external_id,
      item_play_date,
      item_start_time,
      item_score_a,
      item_score_b
    );
  end loop;

  if (
    select count(*)
    from public.tournament_matches as match
    where match.tournament_id = target_tournament_id
  ) <> fixture_count or (
    select count(*)
    from public.tournament_match_planning as planning
    where planning.tournament_id = target_tournament_id
  ) <> fixture_count then
    raise exception 'Imported tournament planning is incomplete' using errcode = 'P0001';
  end if;

  select count(*)::integer
  into verified_player_count
  from public.tournament_team_players as player
  where player.tournament_id = target_tournament_id
    and player.member_id is not null;

  select count(*)::integer
  into external_player_count
  from public.tournament_team_players as player
  where player.tournament_id = target_tournament_id
    and player.member_id is null;

  update public.tournaments
  set
    status = 'planning_generated',
    updated_by = target_profile_id,
    updated_at = now()
  where id = target_tournament_id;

  update public.tournament_imports
  set
    status = 'imported',
    imported_at = now(),
    summary = jsonb_build_object(
      'teamCount', team_count,
      'poolCount', pool_count,
      'matchCount', fixture_count,
      'verifiedPlayerCount', verified_player_count,
      'externalPlayerCount', external_player_count,
      'sourceScoreCount', (
        select count(*)
        from public.tournament_import_fixture_refs as fixture_ref
        where fixture_ref.import_id = target_import_id
          and fixture_ref.source_score_a is not null
          and fixture_ref.source_score_b is not null
      )
    )
  where id = target_import_id;

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
    'errebot_imported',
    'preparation',
    'planning_generated',
    jsonb_build_object(
      'import_id', target_import_id,
      'source_file_hash', input_file_hash,
      'team_count', team_count,
      'pool_count', pool_count,
      'match_count', fixture_count,
      'verified_player_count', verified_player_count,
      'external_player_count', external_player_count
    ),
    target_profile_id
  );

  return jsonb_build_object(
    'importId', target_import_id,
    'tournamentId', target_tournament_id,
    'alreadyImported', false,
    'summary', (
      select import_row.summary
      from public.tournament_imports as import_row
      where import_row.id = target_import_id
    )
  );
end;
$$;

revoke all on function public.admin_import_errebot_tournament(jsonb)
from public, anon;
grant execute on function public.admin_import_errebot_tournament(jsonb)
to authenticated;

commit;
