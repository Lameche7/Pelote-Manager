create type public.championship_result_submission_status as enum (
  'pending',
  'confirmed_official',
  'conflict_official',
  'withdrawn'
);

create table public.championship_result_submissions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.championship_matches (id) on delete cascade,
  team_id uuid not null references public.championship_teams (id) on delete cascade,
  submitted_by uuid references public.profiles (id) on delete set null,
  score_team1 integer not null check (score_team1 between 0 and 200),
  score_team2 integer not null check (score_team2 between 0 and 200),
  comment text,
  status public.championship_result_submission_status not null default 'pending',
  official_score_team1 integer check (official_score_team1 is null or official_score_team1 between 0 and 200),
  official_score_team2 integer check (official_score_team2 is null or official_score_team2 between 0 and 200),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index championship_result_submissions_pending_team_unique
on public.championship_result_submissions (match_id, team_id)
where status = 'pending';

create index championship_result_submissions_match_idx
on public.championship_result_submissions (match_id, created_at desc);

create index championship_result_submissions_submitter_idx
on public.championship_result_submissions (submitted_by, created_at desc)
where submitted_by is not null;

alter table public.championship_result_submissions enable row level security;
revoke all on table public.championship_result_submissions from public, anon, authenticated;

create or replace function public.championship_validate_result_submission_team()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.championship_matches as match
    where match.id = new.match_id
      and new.team_id in (match.team1_id, match.team2_id)
  ) then
    raise exception 'Submission team does not belong to match' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger championship_result_submission_team_guard
before insert or update of match_id, team_id
on public.championship_result_submissions
for each row execute function public.championship_validate_result_submission_team();

create or replace function public.championship_reconcile_result_submissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.score_team1 is not null and new.score_team2 is not null then
    update public.championship_result_submissions as submission
    set status = case
          when submission.score_team1 = new.score_team1
            and submission.score_team2 = new.score_team2
            then 'confirmed_official'::public.championship_result_submission_status
          else 'conflict_official'::public.championship_result_submission_status
        end,
        official_score_team1 = new.score_team1,
        official_score_team2 = new.score_team2,
        resolved_at = now(),
        updated_at = now()
    where submission.match_id = new.id
      and submission.status in ('pending', 'confirmed_official', 'conflict_official');
  elsif old.score_team1 is not null or old.score_team2 is not null then
    update public.championship_result_submissions as submission
    set status = 'pending',
        official_score_team1 = null,
        official_score_team2 = null,
        resolved_at = null,
        updated_at = now()
    where submission.match_id = new.id
      and submission.status in ('confirmed_official', 'conflict_official');
  end if;

  return new;
end;
$$;

create trigger championship_result_submission_official_reconcile
before update of score_team1, score_team2
on public.championship_matches
for each row execute function public.championship_reconcile_result_submissions();

create or replace function public.submit_my_championship_result(
  target_match_id uuid,
  target_score_mine integer,
  target_score_opponent integer,
  target_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  match_row public.championship_matches%rowtype;
  my_team_id uuid;
  canonical_score_team1 integer;
  canonical_score_team2 integer;
  submission_id uuid;
  championship_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if target_score_mine is null
    or target_score_opponent is null
    or target_score_mine not between 0 and 200
    or target_score_opponent not between 0 and 200
  then
    raise exception 'Invalid score' using errcode = '22023';
  end if;

  select match.*
  into match_row
  from public.championship_matches as match
  where match.id = target_match_id;

  if match_row.id is null then
    raise exception 'Championship match not found' using errcode = 'P0002';
  end if;

  if match_row.status = 'cancelled'
    or match_row.score_raw is not null
    or match_row.score_team1 is not null
    or match_row.score_team2 is not null
  then
    raise exception 'Official result already available or match unavailable' using errcode = '22023';
  end if;

  select team.id
  into my_team_id
  from public.championship_teams as team
  where team.id in (match_row.team1_id, match_row.team2_id)
    and exists (
      select 1
      from public.championship_team_players as team_player
      join public.championship_players as player
        on player.id = team_player.player_id
      where team_player.team_id = team.id
        and player.profile_id = actor_id
        and player.link_status in ('claimed', 'verified')
    )
  order by case when team.id = match_row.team1_id then 0 else 1 end
  limit 1;

  if my_team_id is null then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if my_team_id = match_row.team1_id then
    canonical_score_team1 := target_score_mine;
    canonical_score_team2 := target_score_opponent;
  else
    canonical_score_team1 := target_score_opponent;
    canonical_score_team2 := target_score_mine;
  end if;

  update public.championship_result_submissions as previous
  set status = 'withdrawn',
      resolved_at = now(),
      updated_at = now()
  where previous.match_id = target_match_id
    and previous.team_id = my_team_id
    and previous.status = 'pending';

  insert into public.championship_result_submissions (
    match_id,
    team_id,
    submitted_by,
    score_team1,
    score_team2,
    comment
  )
  values (
    target_match_id,
    my_team_id,
    actor_id,
    canonical_score_team1,
    canonical_score_team2,
    nullif(btrim(target_comment), '')
  )
  returning id into submission_id;

  select division.championship_id
  into championship_id
  from public.championship_divisions as division
  where division.id = match_row.division_id;

  insert into public.championship_audit_log (
    championship_id,
    actor_id,
    action,
    payload
  )
  values (
    championship_id,
    actor_id,
    'result_submission.created',
    jsonb_build_object(
      'submissionId', submission_id,
      'matchId', target_match_id,
      'teamId', my_team_id,
      'scoreTeam1', canonical_score_team1,
      'scoreTeam2', canonical_score_team2
    )
  );

  return jsonb_build_object(
    'id', submission_id,
    'matchId', target_match_id,
    'teamId', my_team_id,
    'scoreMine', target_score_mine,
    'scoreOpponent', target_score_opponent,
    'status', 'pending'
  );
end;
$$;

create or replace function public.get_my_championship_result_submissions()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with my_match_teams as (
    select distinct
      match.id as match_id,
      team.id as team_id,
      match.team1_id,
      match.team2_id
    from public.championship_matches as match
    join public.championship_teams as team
      on team.id in (match.team1_id, match.team2_id)
    where exists (
      select 1
      from public.championship_team_players as team_player
      join public.championship_players as player
        on player.id = team_player.player_id
      where team_player.team_id = team.id
        and player.profile_id = auth.uid()
        and player.link_status in ('claimed', 'verified')
    )
  ),
  latest as (
    select distinct on (submission.match_id, submission.team_id)
      submission.*
    from public.championship_result_submissions as submission
    join my_match_teams as mine
      on mine.match_id = submission.match_id
     and mine.team_id = submission.team_id
    where submission.status <> 'withdrawn'
    order by submission.match_id, submission.team_id, submission.created_at desc, submission.id desc
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', submission.id,
        'match_id', submission.match_id,
        'team_id', submission.team_id,
        'score_mine', case
          when submission.team_id = mine.team1_id then submission.score_team1
          else submission.score_team2
        end,
        'score_opponent', case
          when submission.team_id = mine.team1_id then submission.score_team2
          else submission.score_team1
        end,
        'status', submission.status,
        'comment', submission.comment,
        'official_score_mine', case
          when submission.team_id = mine.team1_id then submission.official_score_team1
          else submission.official_score_team2
        end,
        'official_score_opponent', case
          when submission.team_id = mine.team1_id then submission.official_score_team2
          else submission.official_score_team1
        end,
        'created_at', submission.created_at,
        'resolved_at', submission.resolved_at
      )
      order by submission.created_at desc
    ),
    '[]'::jsonb
  )
  from latest as submission
  join my_match_teams as mine
    on mine.match_id = submission.match_id
   and mine.team_id = submission.team_id;
$$;

revoke all on function public.championship_validate_result_submission_team() from public, anon, authenticated;
revoke all on function public.championship_reconcile_result_submissions() from public, anon, authenticated;
revoke all on function public.submit_my_championship_result(uuid, integer, integer, text) from public, anon, authenticated;
revoke all on function public.get_my_championship_result_submissions() from public, anon, authenticated;

grant execute on function public.submit_my_championship_result(uuid, integer, integer, text) to authenticated;
grant execute on function public.get_my_championship_result_submissions() to authenticated;
