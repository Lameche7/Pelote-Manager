begin;

alter table public.championship_teams
  add column if not exists responsible_name text,
  add column if not exists responsible_phone text;

do $migration$
declare
  definition text;
  patched text;
  old_fragment text := $old$
    insert into public.championship_teams (
      division_id,
      federation_club_id,
      pool_id,
      team_number,
      source_label,
      source_rank
    )
    values (
      v_division_id,
      v_federation_club_id,
      v_pool_id,
      btrim(v_source_row ->> 'teamNumber'),
      btrim(v_source_row ->> 'teamLabel'),
      nullif(v_source_row ->> 'sourceRank', '')::integer
    )
    on conflict (division_id, federation_club_id, team_number)
    do update set
      pool_id = excluded.pool_id,
      source_label = excluded.source_label,
      source_rank = excluded.source_rank,
      updated_at = now()
$old$;
  new_fragment text := $new$
    insert into public.championship_teams (
      division_id,
      federation_club_id,
      pool_id,
      team_number,
      source_label,
      source_rank,
      responsible_name,
      responsible_phone
    )
    values (
      v_division_id,
      v_federation_club_id,
      v_pool_id,
      btrim(v_source_row ->> 'teamNumber'),
      btrim(v_source_row ->> 'teamLabel'),
      nullif(v_source_row ->> 'sourceRank', '')::integer,
      nullif(btrim(v_source_row ->> 'responsibleName'), ''),
      nullif(btrim(v_source_row ->> 'responsiblePhone'), '')
    )
    on conflict (division_id, federation_club_id, team_number)
    do update set
      pool_id = excluded.pool_id,
      source_label = excluded.source_label,
      source_rank = excluded.source_rank,
      responsible_name = excluded.responsible_name,
      responsible_phone = excluded.responsible_phone,
      updated_at = now()
$new$;
begin
  definition := replace(
    pg_get_functiondef(
      'public.admin_import_championship_sources(jsonb)'::regprocedure
    ),
    chr(13),
    ''
  );

  if position(old_fragment in definition) = 0 then
    raise exception 'Initial championship team import structure changed unexpectedly';
  end if;

  patched := replace(definition, old_fragment, new_fragment);
  execute patched;
end;
$migration$;

do $migration$
declare
  definition text;
  patched text;
  old_fragment text := $old$
                'opponent_club_name', case
                  when match.team1_id = mine.team_id then opponent_club2.name
                  else opponent_club1.name
                end,
                'opponent_players', (
$old$;
  new_fragment text := $new$
                'opponent_club_name', case
                  when match.team1_id = mine.team_id then opponent_club2.name
                  else opponent_club1.name
                end,
                'opponent_responsible_name', case
                  when match.team1_id = mine.team_id then opponent2.responsible_name
                  else opponent1.responsible_name
                end,
                'opponent_responsible_phone', case
                  when match.team1_id = mine.team_id then opponent2.responsible_phone
                  else opponent1.responsible_phone
                end,
                'opponent_players', (
$new$;
begin
  definition := replace(
    pg_get_functiondef('public.get_my_championships()'::regprocedure),
    chr(13),
    ''
  );

  if position(old_fragment in definition) = 0 then
    raise exception 'My championships opponent structure changed unexpectedly';
  end if;

  patched := replace(definition, old_fragment, new_fragment);
  execute patched;
end;
$migration$;

create or replace function public.admin_update_championship_team_contacts(
  target_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_championship public.championships%rowtype;
  source_row jsonb;
  target_team_id uuid;
  target_responsible_name text;
  target_responsible_phone text;
  team_count integer := 0;
  updated_count integer := 0;
  unchanged_count integer := 0;
begin
  if not public.championship_club_can_manage(target_id, target_club_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if jsonb_typeof(payload) <> 'object'
    or jsonb_typeof(payload -> 'teams') <> 'array'
    or nullif(btrim(payload ->> 'competition'), '') is null
    or nullif(btrim(payload ->> 'specialty'), '') is null
  then
    raise exception 'Championship engagement contacts update is invalid'
      using errcode = '22023';
  end if;

  select championship.*
  into target_championship
  from public.championships as championship
  where championship.id = target_id
  for update;

  if target_championship.id is null
    or target_championship.status = 'archived'
    or public.championship_import_normalize(target_championship.name) <>
       public.championship_import_normalize(payload ->> 'competition')
    or public.championship_import_normalize(target_championship.specialty) <>
       public.championship_import_normalize(payload ->> 'specialty')
  then
    raise exception 'Championship engagement contacts update is invalid'
      using errcode = '22023';
  end if;

  for source_row in
    select value
    from jsonb_array_elements(payload -> 'teams')
  loop
    team_count := team_count + 1;

    if nullif(btrim(source_row ->> 'category'), '') is null
      or nullif(btrim(source_row ->> 'clubName'), '') is null
      or nullif(btrim(source_row ->> 'teamNumber'), '') is null
    then
      raise exception 'Championship engagement contacts update is invalid'
        using errcode = '22023';
    end if;

    target_team_id := null;

    select team.id
    into target_team_id
    from public.championship_teams as team
    join public.championship_divisions as division
      on division.id = team.division_id
    join public.championship_federation_clubs as federation_club
      on federation_club.id = team.federation_club_id
    where division.championship_id = target_id
      and division.normalized_name =
          public.championship_import_normalize(source_row ->> 'category')
      and federation_club.normalized_name =
          public.championship_import_normalize(source_row ->> 'clubName')
      and team.team_number = btrim(source_row ->> 'teamNumber')
    limit 1;

    if target_team_id is null then
      raise exception 'Championship engagement contacts update is invalid'
        using errcode = '22023';
    end if;

    target_responsible_name :=
      nullif(btrim(source_row ->> 'responsibleName'), '');
    target_responsible_phone :=
      nullif(btrim(source_row ->> 'responsiblePhone'), '');

    if exists (
      select 1
      from public.championship_teams as team
      where team.id = target_team_id
        and team.responsible_name is not distinct from target_responsible_name
        and team.responsible_phone is not distinct from target_responsible_phone
    ) then
      unchanged_count := unchanged_count + 1;
    else
      update public.championship_teams as team
      set
        responsible_name = target_responsible_name,
        responsible_phone = target_responsible_phone,
        updated_at = now()
      where team.id = target_team_id;

      updated_count := updated_count + 1;
    end if;
  end loop;

  insert into public.championship_audit_log (
    championship_id,
    club_id,
    actor_id,
    action,
    payload
  )
  values (
    target_id,
    target_club_id,
    auth.uid(),
    'engagement_contacts.updated',
    jsonb_build_object(
      'fileName', nullif(btrim(payload ->> 'fileName'), ''),
      'checksum', nullif(btrim(payload ->> 'checksum'), ''),
      'teamCount', team_count,
      'updatedCount', updated_count,
      'unchangedCount', unchanged_count
    )
  );

  return jsonb_build_object(
    'championshipId', target_id,
    'teamCount', team_count,
    'updatedCount', updated_count,
    'unchangedCount', unchanged_count
  );
end;
$$;

revoke all on function public.admin_update_championship_team_contacts(uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.admin_update_championship_team_contacts(uuid, jsonb)
to authenticated;

comment on function public.admin_update_championship_team_contacts(uuid, jsonb) is
  'Met à jour uniquement Responsable et Tel Responsable des équipes à partir d engagements.csv, avec permission championships.manage.';

commit;
