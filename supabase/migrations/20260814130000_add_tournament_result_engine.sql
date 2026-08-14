begin;

-- Result Engine — saisie collaborative par les joueurs, validation admin et
-- calcul des données sportives élémentaires. Le Ranking Engine consommera
-- uniquement les résultats validés dans une PR dédiée.

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'tournament_match_result_status'
  ) then
    create type public.tournament_match_result_status as enum (
      'pending_validation',
      'validated'
    );
  end if;
end
$$;

create table if not exists public.tournament_match_results (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null unique
    references public.tournament_matches (id)
    on delete cascade,
  tournament_id uuid not null
    references public.tournaments (id)
    on delete cascade,
  status public.tournament_match_result_status not null
    default 'pending_validation',
  score jsonb not null,
  team_a_sets smallint not null default 0 check (team_a_sets >= 0),
  team_b_sets smallint not null default 0 check (team_b_sets >= 0),
  team_a_points integer not null default 0 check (team_a_points >= 0),
  team_b_points integer not null default 0 check (team_b_points >= 0),
  team_a_ranking_points integer not null default 0 check (team_a_ranking_points >= 0),
  team_b_ranking_points integer not null default 0 check (team_b_ranking_points >= 0),
  winner_team_id uuid not null
    references public.tournament_teams (id)
    on delete restrict,
  submitted_by uuid references public.profiles (id) on delete set null,
  submitted_at timestamptz not null default now(),
  validated_by uuid references public.profiles (id) on delete set null,
  validated_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (id, tournament_id)
);

create index if not exists tournament_match_results_tournament_status_idx
on public.tournament_match_results (tournament_id, status, submitted_at);

alter table public.tournament_match_results enable row level security;
revoke all on table public.tournament_match_results
from public, anon, authenticated;

create or replace function public.tournament_profile_can_score_match(
  target_match_id uuid,
  target_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select exists (
      select 1
      from public.tournament_matches as match
      join public.tournament_teams as team
        on team.id in (match.team_a_id, match.team_b_id)
      join public.profiles as profile
        on profile.id = target_profile_id
      where match.id = target_match_id
        and team.status = 'accepted'
        and (
          team.submitted_by = target_profile_id
          or exists (
            select 1
            from public.tournament_team_players as player
            where player.team_id = team.id
              and (
                (
                  profile.member_id is not null
                  and player.member_id = profile.member_id
                )
                or (
                  nullif(btrim(player.email), '') is not null
                  and lower(btrim(player.email)) = lower(btrim(profile.email))
                )
              )
          )
        )
    )
  ), false);
$$;

revoke all on function public.tournament_profile_can_score_match(uuid, uuid)
from public, anon, authenticated;

create or replace function public.tournament_calculate_match_result(
  target_match_id uuid,
  score_payload jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_match public.tournament_matches;
  rules public.tournament_sporting_rules;
  score_sets jsonb := coalesce(score_payload->'sets', '[]'::jsonb);
  set_item jsonb;
  set_count integer;
  set_index integer := 0;
  target_points integer;
  team_a_value integer;
  team_b_value integer;
  team_a_sets integer := 0;
  team_b_sets integer := 0;
  team_a_points integer := 0;
  team_b_points integer := 0;
  team_a_ranking_points integer;
  team_b_ranking_points integer;
  winner_team_id uuid;
  margin integer;
begin
  select match.*
  into target_match
  from public.tournament_matches as match
  where match.id = target_match_id;

  if target_match.id is null then
    raise exception 'Tournament match not found' using errcode = 'P0002';
  end if;

  select sporting_rules.*
  into rules
  from public.tournament_sporting_rules as sporting_rules
  where sporting_rules.tournament_id = target_match.tournament_id;

  if rules.tournament_id is null then
    raise exception 'Tournament sporting rules are missing' using errcode = 'P0001';
  end if;

  if jsonb_typeof(score_sets) <> 'array' then
    raise exception 'Tournament score is invalid' using errcode = '22023';
  end if;

  set_count := jsonb_array_length(score_sets);

  if rules.match_format = 'single_game' and set_count <> 1 then
    raise exception 'A single-game result must contain exactly one score'
      using errcode = '22023';
  end if;

  if rules.match_format = 'best_of_three_sets' and set_count not in (2, 3) then
    raise exception 'A best-of-three result must contain two or three sets'
      using errcode = '22023';
  end if;

  for set_item in
    select value from jsonb_array_elements(score_sets)
  loop
    set_index := set_index + 1;
    team_a_value := nullif(set_item->>'team_a', '')::integer;
    team_b_value := nullif(set_item->>'team_b', '')::integer;

    if team_a_value is null
      or team_b_value is null
      or team_a_value < 0
      or team_b_value < 0
      or team_a_value = team_b_value then
      raise exception 'Tournament set score is invalid' using errcode = '22023';
    end if;

    if rules.match_format = 'single_game' then
      target_points := rules.single_game_points;
    elsif set_index <= 2 then
      target_points := rules.main_set_points;
    else
      target_points := rules.deciding_set_points;
    end if;

    -- La pelote autorise un seul point d'écart : le vainqueur atteint exactement
    -- la cible configurée et le perdant reste strictement en dessous.
    if not (
      (team_a_value = target_points and team_b_value < target_points)
      or (team_b_value = target_points and team_a_value < target_points)
    ) then
      raise exception 'Tournament set score does not match sporting rules'
        using errcode = '22023';
    end if;

    if team_a_value > team_b_value then
      team_a_sets := team_a_sets + 1;
    else
      team_b_sets := team_b_sets + 1;
    end if;

    team_a_points := team_a_points + team_a_value;
    team_b_points := team_b_points + team_b_value;
  end loop;

  if rules.match_format = 'single_game' then
    if team_a_sets = 1 then
      winner_team_id := target_match.team_a_id;
    else
      winner_team_id := target_match.team_b_id;
    end if;
  else
    if set_count = 2 then
      if greatest(team_a_sets, team_b_sets) <> 2
        or least(team_a_sets, team_b_sets) <> 0 then
        raise exception 'A two-set result must be a straight victory'
          using errcode = '22023';
      end if;
    else
      -- Une troisième manche n'existe que si les deux premières sont partagées.
      -- Avec trois manches jouées, le score final doit donc être 2-1.
      if greatest(team_a_sets, team_b_sets) <> 2
        or least(team_a_sets, team_b_sets) <> 1 then
        raise exception 'A three-set result must finish two sets to one'
          using errcode = '22023';
      end if;

      if (
        ((score_sets->0->>'team_a')::integer > (score_sets->0->>'team_b')::integer)
        =
        ((score_sets->1->>'team_a')::integer > (score_sets->1->>'team_b')::integer)
      ) then
        raise exception 'A deciding set is only allowed after one set each'
          using errcode = '22023';
      end if;
    end if;

    if team_a_sets = 2 then
      winner_team_id := target_match.team_a_id;
    else
      winner_team_id := target_match.team_b_id;
    end if;
  end if;

  if winner_team_id = target_match.team_a_id then
    team_a_ranking_points := rules.base_win_points;
    team_b_ranking_points := rules.base_loss_points;
  else
    team_a_ranking_points := rules.base_loss_points;
    team_b_ranking_points := rules.base_win_points;
  end if;

  if rules.match_format = 'best_of_three_sets' then
    if set_count = 2 then
      if winner_team_id = target_match.team_a_id then
        team_a_ranking_points := team_a_ranking_points + rules.offensive_bonus_points;
      else
        team_b_ranking_points := team_b_ranking_points + rules.offensive_bonus_points;
      end if;
    else
      if winner_team_id = target_match.team_a_id then
        team_b_ranking_points := team_b_ranking_points + rules.defensive_bonus_points;
      else
        team_a_ranking_points := team_a_ranking_points + rules.defensive_bonus_points;
      end if;
    end if;
  else
    margin := abs(team_a_points - team_b_points);
    if margin >= rules.offensive_bonus_margin then
      if winner_team_id = target_match.team_a_id then
        team_a_ranking_points := team_a_ranking_points + rules.offensive_bonus_points;
      else
        team_b_ranking_points := team_b_ranking_points + rules.offensive_bonus_points;
      end if;
    end if;

    if margin <= rules.defensive_bonus_margin then
      if winner_team_id = target_match.team_a_id then
        team_b_ranking_points := team_b_ranking_points + rules.defensive_bonus_points;
      else
        team_a_ranking_points := team_a_ranking_points + rules.defensive_bonus_points;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'score', jsonb_build_object('sets', score_sets),
    'team_a_sets', team_a_sets,
    'team_b_sets', team_b_sets,
    'team_a_points', team_a_points,
    'team_b_points', team_b_points,
    'team_a_ranking_points', team_a_ranking_points,
    'team_b_ranking_points', team_b_ranking_points,
    'winner_team_id', winner_team_id
  );
end;
$$;

revoke all on function public.tournament_calculate_match_result(uuid, jsonb)
from public, anon, authenticated;

create or replace function public.submit_my_tournament_match_result(
  target_match_id uuid,
  score_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_profile_id uuid := auth.uid();
  target_match public.tournament_matches;
  target_tournament public.tournaments;
  target_planning public.tournament_match_planning;
  target_timezone text;
  calculated jsonb;
  saved_id uuid;
begin
  if current_profile_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select match.*
  into target_match
  from public.tournament_matches as match
  where match.id = target_match_id
  for update;

  if target_match.id is null then
    raise exception 'Tournament match not found' using errcode = 'P0002';
  end if;

  if not public.tournament_profile_can_score_match(target_match.id, current_profile_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_match.tournament_id;

  if target_tournament.status not in ('planning_published', 'in_progress') then
    raise exception 'Tournament result entry is not available at this stage'
      using errcode = 'P0001';
  end if;

  select planning, resource.timezone
  into target_planning, target_timezone
  from public.tournament_match_planning as planning
  join public.reservable_resources as resource on resource.id = planning.resource_id
  where planning.match_id = target_match.id;

  if target_planning.match_id is null then
    raise exception 'Tournament match is not scheduled' using errcode = 'P0001';
  end if;

  if public.tournament_planning_starts_at(
    target_planning.play_date,
    target_planning.ends_at,
    target_timezone
  ) > now() then
    raise exception 'Tournament result cannot be entered before the scheduled end'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.tournament_match_results as result
    where result.match_id = target_match.id
  ) then
    raise exception 'Tournament result has already been submitted'
      using errcode = 'P0001';
  end if;

  calculated := public.tournament_calculate_match_result(target_match.id, score_payload);

  insert into public.tournament_match_results (
    match_id,
    tournament_id,
    status,
    score,
    team_a_sets,
    team_b_sets,
    team_a_points,
    team_b_points,
    team_a_ranking_points,
    team_b_ranking_points,
    winner_team_id,
    submitted_by,
    submitted_at,
    updated_at
  )
  values (
    target_match.id,
    target_match.tournament_id,
    'pending_validation',
    calculated->'score',
    (calculated->>'team_a_sets')::integer,
    (calculated->>'team_b_sets')::integer,
    (calculated->>'team_a_points')::integer,
    (calculated->>'team_b_points')::integer,
    (calculated->>'team_a_ranking_points')::integer,
    (calculated->>'team_b_ranking_points')::integer,
    (calculated->>'winner_team_id')::uuid,
    current_profile_id,
    now(),
    now()
  )
  returning id into saved_id;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    target_match.tournament_id,
    'match_result_submitted',
    target_tournament.status,
    target_tournament.status,
    jsonb_build_object(
      'match_id', target_match.id,
      'result_id', saved_id,
      'score', calculated->'score'
    ),
    current_profile_id
  );

  return saved_id;
end;
$$;

revoke all on function public.submit_my_tournament_match_result(uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.submit_my_tournament_match_result(uuid, jsonb)
to authenticated;

create or replace function public.admin_validate_tournament_match_result(
  target_match_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_result public.tournament_match_results;
  target_tournament public.tournaments;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select result.*
  into target_result
  from public.tournament_match_results as result
  join public.tournaments as tournament on tournament.id = result.tournament_id
  where result.match_id = target_match_id
    and tournament.club_id = target_club_id
  for update of result;

  if target_result.id is null then
    raise exception 'Tournament result not found' using errcode = 'P0002';
  end if;

  if target_result.status <> 'pending_validation' then
    raise exception 'Tournament result is already validated' using errcode = 'P0001';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_result.tournament_id;

  update public.tournament_match_results
  set
    status = 'validated',
    validated_by = auth.uid(),
    validated_at = now(),
    updated_at = now()
  where id = target_result.id;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    target_result.tournament_id,
    'match_result_validated',
    target_tournament.status,
    target_tournament.status,
    jsonb_build_object(
      'match_id', target_result.match_id,
      'result_id', target_result.id,
      'score', target_result.score
    ),
    auth.uid()
  );
end;
$$;

revoke all on function public.admin_validate_tournament_match_result(uuid)
from public, anon, authenticated;
grant execute on function public.admin_validate_tournament_match_result(uuid)
to authenticated;

create or replace function public.admin_save_tournament_match_result(
  target_match_id uuid,
  score_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_match public.tournament_matches;
  target_tournament public.tournaments;
  previous_result public.tournament_match_results;
  calculated jsonb;
  saved_id uuid;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select match.*
  into target_match
  from public.tournament_matches as match
  join public.tournaments as tournament on tournament.id = match.tournament_id
  where match.id = target_match_id
    and tournament.club_id = target_club_id
  for update of match;

  if target_match.id is null then
    raise exception 'Tournament match not found' using errcode = 'P0002';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_match.tournament_id;

  if target_tournament.status not in (
    'planning_published',
    'in_progress',
    'completed'
  ) then
    raise exception 'Tournament results are not editable at this stage'
      using errcode = 'P0001';
  end if;

  select result.*
  into previous_result
  from public.tournament_match_results as result
  where result.match_id = target_match.id
  for update;

  calculated := public.tournament_calculate_match_result(target_match.id, score_payload);

  insert into public.tournament_match_results (
    match_id,
    tournament_id,
    status,
    score,
    team_a_sets,
    team_b_sets,
    team_a_points,
    team_b_points,
    team_a_ranking_points,
    team_b_ranking_points,
    winner_team_id,
    submitted_by,
    submitted_at,
    validated_by,
    validated_at,
    updated_at
  )
  values (
    target_match.id,
    target_match.tournament_id,
    'validated',
    calculated->'score',
    (calculated->>'team_a_sets')::integer,
    (calculated->>'team_b_sets')::integer,
    (calculated->>'team_a_points')::integer,
    (calculated->>'team_b_points')::integer,
    (calculated->>'team_a_ranking_points')::integer,
    (calculated->>'team_b_ranking_points')::integer,
    (calculated->>'winner_team_id')::uuid,
    auth.uid(),
    coalesce(previous_result.submitted_at, now()),
    auth.uid(),
    now(),
    now()
  )
  on conflict (match_id) do update
  set
    status = 'validated',
    score = excluded.score,
    team_a_sets = excluded.team_a_sets,
    team_b_sets = excluded.team_b_sets,
    team_a_points = excluded.team_a_points,
    team_b_points = excluded.team_b_points,
    team_a_ranking_points = excluded.team_a_ranking_points,
    team_b_ranking_points = excluded.team_b_ranking_points,
    winner_team_id = excluded.winner_team_id,
    validated_by = auth.uid(),
    validated_at = now(),
    updated_at = now()
  returning id into saved_id;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    target_match.tournament_id,
    case when previous_result.id is null
      then 'match_result_entered_by_admin'
      else 'match_result_corrected_by_admin'
    end,
    target_tournament.status,
    target_tournament.status,
    jsonb_build_object(
      'match_id', target_match.id,
      'result_id', saved_id,
      'previous_result', case
        when previous_result.id is null then null
        else to_jsonb(previous_result)
      end,
      'score', calculated->'score'
    ),
    auth.uid()
  );

  return saved_id;
end;
$$;

revoke all on function public.admin_save_tournament_match_result(uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.admin_save_tournament_match_result(uuid, jsonb)
to authenticated;

create or replace function public.admin_get_tournament_results_workspace()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', tournament.id,
        'name', tournament.name,
        'status', tournament.status,
        'sporting_rules', jsonb_build_object(
          'match_format', rules.match_format,
          'single_game_points', rules.single_game_points,
          'main_set_points', rules.main_set_points,
          'deciding_set_points', rules.deciding_set_points
        ),
        'matches', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', match.id,
                'play_date', planning.play_date,
                'starts_at', planning.starts_at,
                'ends_at', planning.ends_at,
                'resource_name', resource.name,
                'series_name', series.name,
                'pool_number', pool.display_order + 1,
                'team_a_label', public.tournament_team_public_label(match.team_a_id),
                'team_b_label', public.tournament_team_public_label(match.team_b_id),
                'result', case when result.id is null then null else jsonb_build_object(
                  'id', result.id,
                  'status', result.status,
                  'score', result.score,
                  'team_a_sets', result.team_a_sets,
                  'team_b_sets', result.team_b_sets,
                  'team_a_points', result.team_a_points,
                  'team_b_points', result.team_b_points,
                  'team_a_ranking_points', result.team_a_ranking_points,
                  'team_b_ranking_points', result.team_b_ranking_points,
                  'submitted_at', result.submitted_at,
                  'validated_at', result.validated_at
                ) end
              )
              order by planning.play_date, planning.starts_at, resource.name, match.id
            ),
            '[]'::jsonb
          )
          from public.tournament_matches as match
          join public.tournament_match_planning as planning on planning.match_id = match.id
          join public.reservable_resources as resource on resource.id = planning.resource_id
          join public.tournament_series as series on series.id = match.series_id
          join public.tournament_pools as pool on pool.id = match.pool_id
          left join public.tournament_match_results as result on result.match_id = match.id
          where match.tournament_id = tournament.id
        )
      )
      order by tournament.starts_on desc, tournament.name
    ),
    '[]'::jsonb
  )
  from public.tournaments as tournament
  join public.tournament_sporting_rules as rules on rules.tournament_id = tournament.id
  where tournament.club_id = public.admin_current_club_id()
    and public.has_club_permission(tournament.club_id, 'tournaments.manage')
    and tournament.status in (
      'planning_published',
      'in_progress',
      'completed',
      'archived'
    );
$$;

revoke all on function public.admin_get_tournament_results_workspace()
from public, anon, authenticated;
grant execute on function public.admin_get_tournament_results_workspace()
to authenticated;

-- Enrichit Mes Tournois avec la configuration sportive, le résultat éventuel et
-- le droit de saisie. Le rapprochement par email permet aussi à un joueur
-- extérieur ayant créé un compte invité de retrouver sa participation lorsque
-- son email figure dans l'inscription.
create or replace function public.get_my_tournaments()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_profile_id uuid := auth.uid();
  current_member_id uuid;
  current_profile_email text;
  result jsonb;
begin
  if current_profile_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select profile.member_id, profile.email
  into current_member_id, current_profile_email
  from public.profiles as profile
  where profile.id = current_profile_id;

  if not found then
    raise exception 'Profile required' using errcode = '42501';
  end if;

  with my_teams as (
    select distinct on (team.tournament_id)
      team.id,
      team.tournament_id,
      team.series_id,
      team.status,
      team.submitted_by,
      team.registered_at
    from public.tournament_teams as team
    where team.status in ('pending', 'accepted')
      and (
        team.submitted_by = current_profile_id
        or exists (
          select 1
          from public.tournament_team_players as player
          where player.team_id = team.id
            and (
              (
                current_member_id is not null
                and player.member_id = current_member_id
              )
              or (
                nullif(btrim(player.email), '') is not null
                and lower(btrim(player.email)) = lower(btrim(current_profile_email))
              )
            )
        )
      )
    order by
      team.tournament_id,
      case when team.status = 'accepted' then 0 else 1 end,
      team.registered_at desc
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', tournament.id,
        'name', tournament.name,
        'status', tournament.status,
        'starts_on', tournament.starts_on,
        'ends_on', tournament.ends_on,
        'registration_closes_at', tournament.registration_closes_at,
        'sporting_rules', jsonb_build_object(
          'match_format', sporting_rules.match_format,
          'single_game_points', sporting_rules.single_game_points,
          'main_set_points', sporting_rules.main_set_points,
          'deciding_set_points', sporting_rules.deciding_set_points
        ),
        'team', jsonb_build_object(
          'id', team.id,
          'status', team.status,
          'series_id', series.id,
          'series_name', series.name,
          'series_color', series.color,
          'pool_number', pool_assignment.pool_number,
          'can_manage_registration',
            team.submitted_by = current_profile_id
            and tournament.status = 'registrations_open'
            and tournament.registration_closes_at > now(),
          'players', (
            select coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'first_name', player.first_name,
                  'last_name', player.last_name,
                  'club_name', player.club_name,
                  'role', player.role
                )
                order by player.display_order
              ),
              '[]'::jsonb
            )
            from public.tournament_team_players as player
            where player.team_id = team.id
          )
        ),
        'planning_published', tournament.status in (
          'planning_published',
          'in_progress',
          'completed',
          'archived'
        ),
        'matches', case
          when tournament.status in (
            'planning_published',
            'in_progress',
            'completed',
            'archived'
          ) then (
            select coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'id', tournament_match.id,
                  'play_date', planning.play_date,
                  'starts_at', planning.starts_at,
                  'ends_at', planning.ends_at,
                  'resource_name', resource.name,
                  'pool_number', match_pool.display_order + 1,
                  'team_side', case
                    when tournament_match.team_a_id = team.id then 'a'
                    else 'b'
                  end,
                  'can_submit_result',
                    tournament.status in ('planning_published', 'in_progress')
                    and match_result.id is null
                    and public.tournament_planning_starts_at(
                      planning.play_date,
                      planning.ends_at,
                      resource.timezone
                    ) <= now(),
                  'result', case when match_result.id is null then null else jsonb_build_object(
                    'id', match_result.id,
                    'status', match_result.status,
                    'score', match_result.score,
                    'team_a_sets', match_result.team_a_sets,
                    'team_b_sets', match_result.team_b_sets,
                    'team_a_points', match_result.team_a_points,
                    'team_b_points', match_result.team_b_points,
                    'team_a_ranking_points', match_result.team_a_ranking_points,
                    'team_b_ranking_points', match_result.team_b_ranking_points
                  ) end,
                  'opponent_team_id', opponent.id,
                  'opponent_players', (
                    select coalesce(
                      jsonb_agg(
                        jsonb_build_object(
                          'first_name', opponent_player.first_name,
                          'last_name', opponent_player.last_name,
                          'club_name', opponent_player.club_name,
                          'role', opponent_player.role
                        )
                        order by opponent_player.display_order
                      ),
                      '[]'::jsonb
                    )
                    from public.tournament_team_players as opponent_player
                    where opponent_player.team_id = opponent.id
                  )
                )
                order by planning.play_date, planning.starts_at, resource.name
              ),
              '[]'::jsonb
            )
            from public.tournament_matches as tournament_match
            join public.tournament_match_planning as planning
              on planning.match_id = tournament_match.id
            join public.reservable_resources as resource
              on resource.id = planning.resource_id
            join public.tournament_pools as match_pool
              on match_pool.id = tournament_match.pool_id
            join public.tournament_teams as opponent
              on opponent.id = case
                when tournament_match.team_a_id = team.id
                  then tournament_match.team_b_id
                else tournament_match.team_a_id
              end
            left join public.tournament_match_results as match_result
              on match_result.match_id = tournament_match.id
            where tournament_match.tournament_id = tournament.id
              and team.id in (
                tournament_match.team_a_id,
                tournament_match.team_b_id
              )
          )
          else '[]'::jsonb
        end
      )
      order by
        case
          when tournament.status in ('completed', 'archived', 'cancelled') then 1
          else 0
        end,
        tournament.starts_on,
        tournament.name
    ),
    '[]'::jsonb
  )
  into result
  from my_teams as team
  join public.tournaments as tournament on tournament.id = team.tournament_id
  join public.tournament_series as series on series.id = team.series_id
  join public.tournament_sporting_rules as sporting_rules
    on sporting_rules.tournament_id = tournament.id
  left join lateral (
    select pool.display_order + 1 as pool_number
    from public.tournament_pool_teams as assignment
    join public.tournament_pools as pool on pool.id = assignment.pool_id
    where assignment.team_id = team.id
    limit 1
  ) as pool_assignment on true;

  return result;
end;
$$;

revoke all on function public.get_my_tournaments()
from public, anon, authenticated;
grant execute on function public.get_my_tournaments() to authenticated;

commit;
