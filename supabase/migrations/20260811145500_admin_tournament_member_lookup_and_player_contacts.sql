begin;

-- PR72 complément — l'ajout/modification admin reconnaît les licenciés du club
-- pour chacun des deux joueurs et ne demande plus un contact d'équipe en doublon.
-- Les colonnes contact_email/contact_phone de tournament_teams sont conservées
-- pour compatibilité, mais sont désormais dérivées automatiquement des joueurs.

create or replace function public.admin_search_tournament_members(
  target_tournament_id uuid,
  search_text text,
  excluded_team_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  normalized_search text := lower(btrim(coalesce(search_text, '')));
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.tournaments as tournament
    where tournament.id = target_tournament_id
      and tournament.club_id = target_club_id
  ) then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if length(normalized_search) < 2 then
    return '[]'::jsonb;
  end if;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', candidate.id,
          'first_name', candidate.first_name,
          'last_name', candidate.last_name,
          'club_name', candidate.club_name,
          'has_email', candidate.has_email,
          'has_phone', candidate.has_phone
        )
        order by candidate.last_name, candidate.first_name
      ),
      '[]'::jsonb
    )
    from (
      select
        member.id,
        member.first_name,
        member.last_name,
        club.name as club_name,
        nullif(btrim(member.email), '') is not null as has_email,
        nullif(btrim(member.phone), '') is not null as has_phone
      from public.club_members as member
      join public.clubs as club on club.id = member.club_id
      where member.club_id = target_club_id
        and member.is_active
        and lower(concat_ws(' ', member.first_name, member.last_name))
          like '%' || normalized_search || '%'
        and not exists (
          select 1
          from public.tournament_team_players as existing_player
          join public.tournament_teams as existing_team
            on existing_team.id = existing_player.team_id
          where existing_player.tournament_id = target_tournament_id
            and existing_player.member_id = member.id
            and existing_team.status in ('pending', 'accepted')
            and (
              excluded_team_id is null
              or existing_player.team_id <> excluded_team_id
            )
        )
      order by member.last_name, member.first_name
      limit 12
    ) as candidate
  );
end;
$$;

create or replace function public.tournament_admin_players_with_member_flags(
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
        'email_from_member', coalesce(member_stats.has_email, false),
        'phone_from_member', coalesce(member_stats.has_phone, false)
      )
      order by player_item.ordinality
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(coalesce(base_players, '[]'::jsonb))
    with ordinality as player_item(value, ordinality)
  left join lateral (
    select
      nullif(btrim(member.email), '') is not null as has_email,
      nullif(btrim(member.phone), '') is not null as has_phone
    from public.club_members as member
    where member.id = nullif(player_item.value->>'member_id', '')::uuid
      and exists (
        select 1
        from public.tournament_team_players as stored_player
        where stored_player.team_id = target_team_id
          and stored_player.member_id = member.id
      )
  ) as member_stats on true;
$$;

create or replace function public.admin_list_tournament_teams_v3(
  target_tournament_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_payload jsonb;
begin
  base_payload := public.admin_list_tournament_teams_v2(target_tournament_id);

  return base_payload || jsonb_build_object(
    'teams', (
      select coalesce(
        jsonb_agg(
          team_item.value || jsonb_build_object(
            'players', public.tournament_admin_players_with_member_flags(
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

create or replace function public.admin_save_tournament_team_v5(
  target_tournament_id uuid,
  target_team_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  player_values jsonb := coalesce(payload->'players', '[]'::jsonb);
  player_item jsonb;
  normalized_players jsonb := '[]'::jsonb;
  seen_member_ids uuid[] := '{}'::uuid[];
  item_member_id uuid;
  item_role text;
  item_first_name text;
  item_last_name text;
  item_club_name text;
  item_email text;
  item_phone text;
  member_row public.club_members;
  member_club_name text;
  normalized_payload jsonb;
  derived_email text;
  derived_phone text;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.tournaments as tournament
    where tournament.id = target_tournament_id
      and tournament.club_id = target_club_id
  ) then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if jsonb_typeof(player_values) <> 'array'
    or jsonb_array_length(player_values) <> 2 then
    raise exception 'A tournament team must contain exactly two players'
      using errcode = '22023';
  end if;

  for player_item in
    select value from jsonb_array_elements(player_values)
  loop
    item_member_id := nullif(player_item->>'member_id', '')::uuid;
    item_role := coalesce(player_item->>'role', '');
    item_first_name := btrim(coalesce(player_item->>'first_name', ''));
    item_last_name := btrim(coalesce(player_item->>'last_name', ''));
    item_club_name := btrim(coalesce(player_item->>'club_name', ''));
    item_email := btrim(coalesce(player_item->>'email', ''));
    item_phone := btrim(coalesce(player_item->>'phone', ''));

    if item_member_id is not null then
      if item_member_id = any(seen_member_ids) then
        raise exception 'Tournament players are invalid' using errcode = '22023';
      end if;
      seen_member_ids := array_append(seen_member_ids, item_member_id);

      select member, club.name
      into member_row, member_club_name
      from public.club_members as member
      join public.clubs as club on club.id = member.club_id
      where member.id = item_member_id
        and member.club_id = target_club_id
        and member.is_active;

      if member_row.id is null then
        raise exception 'Tournament member is invalid' using errcode = '22023';
      end if;

      item_first_name := btrim(member_row.first_name);
      item_last_name := btrim(member_row.last_name);
      item_club_name := btrim(member_club_name);
      item_email := coalesce(nullif(btrim(member_row.email), ''), item_email);
      item_phone := coalesce(nullif(btrim(member_row.phone), ''), item_phone);
    end if;

    if item_role not in ('front', 'back')
      or item_first_name = ''
      or item_last_name = ''
      or item_club_name = '' then
      raise exception 'Tournament players are invalid' using errcode = '22023';
    end if;

    if item_email = '' or item_phone = '' then
      raise exception 'Tournament player contacts are incomplete'
        using errcode = '22023';
    end if;

    normalized_players := normalized_players || jsonb_build_array(
      jsonb_build_object(
        'member_id', item_member_id,
        'role', item_role,
        'first_name', item_first_name,
        'last_name', item_last_name,
        'club_name', item_club_name,
        'email', item_email,
        'phone', item_phone
      )
    );
  end loop;

  derived_email := btrim(coalesce(normalized_players->0->>'email', ''));
  derived_phone := btrim(coalesce(normalized_players->0->>'phone', ''));

  normalized_payload := payload || jsonb_build_object(
    'players', normalized_players,
    'contact_email', derived_email,
    'contact_phone', derived_phone
  );

  return public.admin_save_tournament_team_v4(
    target_tournament_id,
    target_team_id,
    normalized_payload
  );
end;
$$;

revoke all on function public.admin_search_tournament_members(uuid, text, uuid)
from public, anon, authenticated;
revoke all on function public.tournament_admin_players_with_member_flags(uuid, jsonb)
from public, anon, authenticated;
revoke all on function public.admin_list_tournament_teams_v3(uuid)
from public, anon, authenticated;
revoke all on function public.admin_save_tournament_team_v5(uuid, uuid, jsonb)
from public, anon, authenticated;

-- Les anciennes RPC restent disponibles uniquement comme briques internes.
revoke all on function public.admin_save_tournament_team_v4(uuid, uuid, jsonb)
from authenticated;
revoke all on function public.admin_list_tournament_teams_v2(uuid)
from authenticated;

grant execute on function public.admin_search_tournament_members(uuid, text, uuid)
to authenticated;
grant execute on function public.admin_list_tournament_teams_v3(uuid)
to authenticated;
grant execute on function public.admin_save_tournament_team_v5(uuid, uuid, jsonb)
to authenticated;

commit;
