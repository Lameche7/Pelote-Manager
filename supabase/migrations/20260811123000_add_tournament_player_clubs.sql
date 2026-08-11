begin;

-- PR71 — affiliation club des joueurs de tournoi.
-- Le club est figé sur la ligne d'inscription du joueur afin qu'un changement
-- ultérieur de fiche licencié ne modifie pas rétroactivement un tournoi.

alter table public.tournament_team_players
add column if not exists club_name text not null default '';

-- Les joueurs liés à une fiche licencié héritent immédiatement du nom du club.
update public.tournament_team_players as player
set club_name = club.name
from public.club_members as member
join public.clubs as club on club.id = member.club_id
where player.member_id = member.id
  and btrim(player.club_name) = '';

-- Les équipes de test existantes reçoivent une affiliation déterministe afin
-- de pouvoir tester immédiatement l'équilibrage inter-clubs.
with ranked_test_teams as (
  select
    link.team_id,
    row_number() over (
      partition by team.series_id
      order by team.registered_at, team.id
    ) as team_rank
  from public.tournament_test_data_teams as link
  join public.tournament_teams as team on team.id = link.team_id
)
update public.tournament_team_players as player
set club_name = concat('Club test ', ((ranked.team_rank - 1) % 8) + 1)
from ranked_test_teams as ranked
where player.team_id = ranked.team_id
  and btrim(player.club_name) = '';

create index if not exists tournament_team_players_club_name_idx
on public.tournament_team_players (tournament_id, club_name)
where btrim(club_name) <> '';

-- Réutilise les projections JSON existantes et y ajoute simplement le snapshot
-- club correspondant à chaque joueur, en conservant l'ordre et les autres clés.
create or replace function public.tournament_players_with_clubs(
  target_team_id uuid,
  base_players jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      player_item.value || jsonb_build_object(
        'club_name', coalesce(stored_player.club_name, '')
      )
      order by player_item.ordinality
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(coalesce(base_players, '[]'::jsonb))
    with ordinality as player_item(value, ordinality)
  left join public.tournament_team_players as stored_player
    on stored_player.team_id = target_team_id
   and stored_player.role::text = player_item.value->>'role';
$$;

revoke all on function public.tournament_players_with_clubs(uuid, jsonb)
from public, anon, authenticated;

create or replace function public.get_my_tournament_registration_identity_v2(
  target_tournament_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_identity jsonb;
  target_member_id uuid;
  target_club_name text := '';
begin
  base_identity := public.get_my_tournament_registration_identity(
    target_tournament_id
  );
  target_member_id := nullif(base_identity->>'member_id', '')::uuid;

  if target_member_id is not null then
    select club.name
    into target_club_name
    from public.club_members as member
    join public.clubs as club on club.id = member.club_id
    where member.id = target_member_id
      and member.is_active;
  end if;

  return base_identity || jsonb_build_object(
    'club_name', coalesce(target_club_name, '')
  );
end;
$$;

create or replace function public.get_my_tournament_registration_v3(
  target_tournament_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_registration jsonb;
  target_team_id uuid;
begin
  base_registration := public.get_my_tournament_registration_v2(
    target_tournament_id
  );
  if base_registration is null then
    return null;
  end if;

  target_team_id := nullif(base_registration->>'id', '')::uuid;
  return base_registration || jsonb_build_object(
    'players', public.tournament_players_with_clubs(
      target_team_id,
      base_registration->'players'
    )
  );
end;
$$;

create or replace function public.get_public_tournament_v2(target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_tournament jsonb;
begin
  base_tournament := public.get_public_tournament(target_id);
  if base_tournament is null then
    return null;
  end if;

  return base_tournament || jsonb_build_object(
    'teams', (
      select coalesce(
        jsonb_agg(
          team_item.value || jsonb_build_object(
            'players', public.tournament_players_with_clubs(
              (team_item.value->>'id')::uuid,
              team_item.value->'players'
            )
          )
          order by team_item.ordinality
        ),
        '[]'::jsonb
      )
      from jsonb_array_elements(coalesce(base_tournament->'teams', '[]'::jsonb))
        with ordinality as team_item(value, ordinality)
    )
  );
end;
$$;

create or replace function public.admin_list_tournament_teams_v2(
  target_tournament_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_payload jsonb;
begin
  base_payload := public.admin_list_tournament_teams(target_tournament_id);

  return base_payload || jsonb_build_object(
    'teams', (
      select coalesce(
        jsonb_agg(
          team_item.value || jsonb_build_object(
            'players', public.tournament_players_with_clubs(
              (team_item.value->>'id')::uuid,
              team_item.value->'players'
            )
          )
          order by team_item.ordinality
        ),
        '[]'::jsonb
      )
      from jsonb_array_elements(coalesce(base_payload->'teams', '[]'::jsonb))
        with ordinality as team_item(value, ordinality)
    )
  );
end;
$$;

create or replace function public.admin_get_tournament_pool_workspace_v2(
  target_tournament_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_workspace jsonb;
begin
  base_workspace := public.admin_get_tournament_pool_workspace(
    target_tournament_id
  );

  return base_workspace || jsonb_build_object(
    'teams', (
      select coalesce(
        jsonb_agg(
          team_item.value || jsonb_build_object(
            'players', public.tournament_players_with_clubs(
              (team_item.value->>'id')::uuid,
              team_item.value->'players'
            )
          )
          order by team_item.ordinality
        ),
        '[]'::jsonb
      )
      from jsonb_array_elements(coalesce(base_workspace->'teams', '[]'::jsonb))
        with ordinality as team_item(value, ordinality)
    )
  );
end;
$$;

-- Inscription publique : on laisse le moteur v2 validé enregistrer l'équipe et
-- ses disponibilités, puis on fige les clubs dans la même transaction.
create or replace function public.save_my_tournament_registration_v3(
  target_tournament_id uuid,
  payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_team_id uuid;
  submitter_role text := coalesce(payload->>'submitter_role', '');
  partner_role text;
  submitter_club_name text := btrim(coalesce(payload->>'submitter_club_name', ''));
  partner_club_name text := btrim(coalesce(payload->>'partner_club_name', ''));
begin
  if submitter_role not in ('front', 'back') then
    raise exception 'Tournament player role is invalid' using errcode = '22023';
  end if;
  partner_role := case when submitter_role = 'front' then 'back' else 'front' end;

  if submitter_club_name = ''
    or partner_club_name = ''
    or length(submitter_club_name) > 120
    or length(partner_club_name) > 120 then
    raise exception 'Tournament player clubs are incomplete'
      using errcode = '22023';
  end if;

  target_team_id := public.save_my_tournament_registration_v2(
    target_tournament_id,
    payload
  );

  update public.tournament_team_players as player
  set club_name = case
    when player.member_id is not null then coalesce((
      select club.name
      from public.club_members as member
      join public.clubs as club on club.id = member.club_id
      where member.id = player.member_id
      limit 1
    ), '')
    when player.role::text = submitter_role then submitter_club_name
    when player.role::text = partner_role then partner_club_name
    else ''
  end
  where player.team_id = target_team_id;

  if exists (
    select 1
    from public.tournament_team_players as player
    where player.team_id = target_team_id
      and btrim(player.club_name) = ''
  ) then
    raise exception 'Tournament player clubs are incomplete'
      using errcode = '22023';
  end if;

  return target_team_id;
end;
$$;

-- Back-office : même principe, en utilisant le club saisi pour un joueur externe
-- et le club réel de la fiche lorsqu'un member_id est présent.
create or replace function public.admin_save_tournament_team_v3(
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
  saved_team_id uuid;
  player_item jsonb;
  item_member_id uuid;
  item_club_name text;
begin
  if jsonb_typeof(coalesce(payload->'players', '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(payload->'players', '[]'::jsonb)) <> 2 then
    raise exception 'A tournament team must contain exactly two players'
      using errcode = '22023';
  end if;

  for player_item in
    select value from jsonb_array_elements(payload->'players')
  loop
    item_member_id := nullif(player_item->>'member_id', '')::uuid;
    item_club_name := btrim(coalesce(player_item->>'club_name', ''));
    if item_member_id is null
      and (item_club_name = '' or length(item_club_name) > 120) then
      raise exception 'Tournament player clubs are incomplete'
        using errcode = '22023';
    end if;
  end loop;

  saved_team_id := public.admin_save_tournament_team_v2(
    target_tournament_id,
    target_team_id,
    payload
  );

  update public.tournament_team_players as player
  set club_name = case
    when player.member_id is not null then coalesce((
      select club.name
      from public.club_members as member
      join public.clubs as club on club.id = member.club_id
      where member.id = player.member_id
      limit 1
    ), '')
    else coalesce((
      select btrim(item.value->>'club_name')
      from jsonb_array_elements(payload->'players') as item(value)
      where item.value->>'role' = player.role::text
      limit 1
    ), '')
  end
  where player.team_id = saved_team_id;

  if exists (
    select 1
    from public.tournament_team_players as player
    where player.team_id = saved_team_id
      and btrim(player.club_name) = ''
  ) then
    raise exception 'Tournament player clubs are incomplete'
      using errcode = '22023';
  end if;

  return saved_team_id;
end;
$$;

-- Le générateur de test conserve toutes ses garanties précédentes, puis affecte
-- plusieurs clubs fictifs aux nouvelles équipes pour éprouver le Pool Engine.
do $$
begin
  if to_regprocedure(
    'public.generate_tournament_test_data_before_club_affiliation(uuid,integer)'
  ) is null then
    alter function public.generate_tournament_test_data(uuid, integer)
    rename to generate_tournament_test_data_before_club_affiliation;
  end if;
end
$$;

create or replace function public.generate_tournament_test_data(
  target_tournament_id uuid,
  target_teams_per_series integer default 8
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  target_batch_id uuid;
begin
  result := public.generate_tournament_test_data_before_club_affiliation(
    target_tournament_id,
    target_teams_per_series
  );
  target_batch_id := nullif(result->>'batch_id', '')::uuid;

  if target_batch_id is not null then
    with ranked_batch_teams as (
      select
        link.team_id,
        row_number() over (
          partition by team.series_id
          order by team.registered_at, team.id
        ) as team_rank
      from public.tournament_test_data_teams as link
      join public.tournament_teams as team on team.id = link.team_id
      where link.batch_id = target_batch_id
    )
    update public.tournament_team_players as player
    set club_name = concat('Club test ', ((ranked.team_rank - 1) % 8) + 1)
    from ranked_batch_teams as ranked
    where player.team_id = ranked.team_id;
  end if;

  return result || jsonb_build_object('synthetic_club_count', 8);
end;
$$;

-- Les anciens points d'écriture restent utilisables par les wrappers SECURITY
-- DEFINER, mais ne sont plus directement appelables par un utilisateur connecté.
revoke all on function public.save_my_tournament_registration(uuid, jsonb)
from authenticated;
revoke all on function public.save_my_tournament_registration_v2(uuid, jsonb)
from authenticated;
revoke all on function public.admin_save_tournament_team_v2(uuid, uuid, jsonb)
from authenticated;

revoke all on function public.get_my_tournament_registration_identity_v2(uuid)
from public, anon, authenticated;
revoke all on function public.get_my_tournament_registration_v3(uuid)
from public, anon, authenticated;
revoke all on function public.get_public_tournament_v2(uuid)
from public, anon, authenticated;
revoke all on function public.admin_list_tournament_teams_v2(uuid)
from public, anon, authenticated;
revoke all on function public.admin_get_tournament_pool_workspace_v2(uuid)
from public, anon, authenticated;
revoke all on function public.save_my_tournament_registration_v3(uuid, jsonb)
from public, anon, authenticated;
revoke all on function public.admin_save_tournament_team_v3(uuid, uuid, jsonb)
from public, anon, authenticated;
revoke all on function public.generate_tournament_test_data(uuid, integer)
from public, anon, authenticated;
revoke all on function public.generate_tournament_test_data_before_club_affiliation(uuid, integer)
from public, anon, authenticated;

grant execute on function public.get_public_tournament_v2(uuid)
to anon, authenticated;
grant execute on function public.get_my_tournament_registration_identity_v2(uuid)
to authenticated;
grant execute on function public.get_my_tournament_registration_v3(uuid)
to authenticated;
grant execute on function public.save_my_tournament_registration_v3(uuid, jsonb)
to authenticated;
grant execute on function public.admin_list_tournament_teams_v2(uuid)
to authenticated;
grant execute on function public.admin_get_tournament_pool_workspace_v2(uuid)
to authenticated;
grant execute on function public.admin_save_tournament_team_v3(uuid, uuid, jsonb)
to authenticated;

commit;
