create or replace function public.admin_preview_championship_standings_import(
  target_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_preview jsonb;
  v_other_issues jsonb := '[]'::jsonb;
  v_missing_non_forfeit_count integer := 0;
  v_general_forfeit_count integer := 0;
  v_general_forfeit_labels text;
begin
  v_preview := public.admin_preview_championship_standings_import_strict(target_id, payload);

  if coalesce((v_preview ->> 'valid')::boolean, false) then
    return v_preview;
  end if;

  select coalesce(jsonb_agg(issue), '[]'::jsonb)
    into v_other_issues
  from jsonb_array_elements(coalesce(v_preview -> 'issues', '[]'::jsonb)) as issue
  where issue ->> 'code' <> 'incomplete_pool';

  if jsonb_array_length(v_other_issues) > 0 then
    return v_preview;
  end if;

  with incoming_teams as (
    select distinct pool.id as pool_id, team.id as team_id
    from jsonb_array_elements(payload -> 'standings') as source_row(value)
    join public.championship_divisions as division
      on division.championship_id = target_id
     and division.normalized_name = source_row.value ->> 'divisionNormalized'
    join public.championship_pools as pool
      on pool.division_id = division.id
     and pool.code = source_row.value ->> 'poolCode'
    join public.championship_federation_clubs as federation_club
      on federation_club.normalized_name = source_row.value ->> 'clubNormalized'
    join public.championship_teams as team
      on team.division_id = division.id
     and team.pool_id = pool.id
     and team.federation_club_id = federation_club.id
     and team.team_number = source_row.value ->> 'teamNumber'
  ),
  touched_pools as (
    select distinct pool_id from incoming_teams
  ),
  missing as (
    select team.id, team.source_label, team.pool_id,
      exists (
        select 1
        from public.championship_matches as match
        where match.pool_id = team.pool_id
          and (match.team1_id = team.id or match.team2_id = team.id)
      )
      and not exists (
        select 1
        from public.championship_matches as match
        where match.pool_id = team.pool_id
          and (match.team1_id = team.id or match.team2_id = team.id)
          and not (
            (match.team1_id = team.id and coalesce(match.score_raw, '') ilike 'Forfait général (Eq1)%')
            or
            (match.team2_id = team.id and coalesce(match.score_raw, '') ilike 'Forfait général (Eq2)%')
          )
      ) as is_general_forfeit
    from touched_pools
    join public.championship_teams as team on team.pool_id = touched_pools.pool_id
    where not exists (
      select 1 from incoming_teams
      where incoming_teams.pool_id = team.pool_id
        and incoming_teams.team_id = team.id
    )
  )
  select
    count(*) filter (where not is_general_forfeit)::integer,
    count(*) filter (where is_general_forfeit)::integer,
    string_agg(source_label, ', ' order by source_label) filter (where is_general_forfeit)
  into v_missing_non_forfeit_count, v_general_forfeit_count, v_general_forfeit_labels
  from missing;

  if v_missing_non_forfeit_count > 0 then
    return v_preview;
  end if;

  if v_general_forfeit_count > 0 then
    v_other_issues := jsonb_build_array(jsonb_build_object(
      'code', 'general_forfeit_excluded',
      'message', format(
        '%s équipe(s) déclarée(s) forfait général ne figurent pas dans le classement publié et sont volontairement laissée(s) sans rang : %s.',
        v_general_forfeit_count,
        v_general_forfeit_labels
      )
    ));
  end if;

  return jsonb_set(
    jsonb_set(v_preview, '{issues}', v_other_issues, true),
    '{valid}',
    'true'::jsonb,
    true
  );
end;
$$;

revoke all on function public.admin_preview_championship_standings_import(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.admin_preview_championship_standings_import(uuid, jsonb) to authenticated;
