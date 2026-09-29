begin;

create or replace function public.get_my_external_participations()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_profile_id uuid := auth.uid();
  current_profile public.profiles%rowtype;
begin
  if current_profile_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select profile.*
  into current_profile
  from public.profiles as profile
  where profile.id = current_profile_id;

  if current_profile.id is null then
    raise exception 'Profile required' using errcode = '42501';
  end if;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'externalIdentityId', linked.external_identity_id,
          'tournamentId', linked.tournament_id,
          'teamId', linked.team_id,
          'tournamentName', linked.tournament_name,
          'seriesName', linked.series_name,
          'partnerFirstName', linked.partner_first_name,
          'partnerLastName', linked.partner_last_name,
          'role', linked.role
        )
        order by linked.starts_on desc, linked.tournament_name, linked.team_id
      ),
      '[]'::jsonb
    )
    from (
      select distinct
        identity.id as external_identity_id,
        tournament.id as tournament_id,
        team.id as team_id,
        tournament.name as tournament_name,
        series.name as series_name,
        partner.first_name as partner_first_name,
        partner.last_name as partner_last_name,
        player.role,
        tournament.starts_on
      from public.tournament_external_player_identities as identity
      join public.tournament_team_players as player
        on player.external_identity_id = identity.id
      join public.tournament_teams as team
        on team.id = player.team_id
       and team.tournament_id = player.tournament_id
      join public.tournaments as tournament
        on tournament.id = player.tournament_id
      join public.tournament_series as series
        on series.id = team.series_id
       and series.tournament_id = tournament.id
      left join lateral (
        select other.first_name, other.last_name
        from public.tournament_team_players as other
        where other.team_id = player.team_id
          and other.id <> player.id
        order by other.display_order, other.id
        limit 1
      ) as partner on true
      left join public.club_members as identity_member
        on identity_member.id = identity.member_id
      where identity.status = 'verified'
        and (
          identity.profile_id = current_profile_id
          or (
            current_profile.sport_player_id is not null
            and identity_member.sport_player_id = current_profile.sport_player_id
          )
          or (
            current_profile.sport_player_id is null
            and current_profile.member_id is not null
            and identity.member_id = current_profile.member_id
          )
        )
      order by tournament.starts_on desc, tournament.name, team.id
    ) as linked
  );
end;
$$;

revoke all on function public.get_my_external_participations()
from public, anon, authenticated;
grant execute on function public.get_my_external_participations()
to authenticated;

create or replace function public.get_my_tournament_registration_identity(
  target_tournament_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_user_id uuid := auth.uid();
  target_club_id uuid;
  current_profile public.profiles%rowtype;
  current_member public.club_members%rowtype;
  current_member_id uuid;
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

  select profile.*
  into current_profile
  from public.profiles as profile
  where profile.id = target_user_id;

  if current_profile.id is null then
    raise exception 'Profile required' using errcode = '42501';
  end if;

  current_member_id := public.profile_club_member_id(
    current_profile.id,
    target_club_id
  );

  if current_member_id is not null then
    select member.*
    into current_member
    from public.club_members as member
    where member.id = current_member_id
      and member.club_id = target_club_id
      and member.is_active;
  end if;

  return jsonb_build_object(
    'member_id', current_member.id,
    'first_name', coalesce(
      nullif(btrim(current_member.first_name), ''),
      nullif(btrim(current_profile.first_name), ''),
      ''
    ),
    'last_name', coalesce(
      nullif(btrim(current_member.last_name), ''),
      nullif(btrim(current_profile.last_name), ''),
      ''
    ),
    'email', coalesce(
      nullif(btrim(current_member.email), ''),
      nullif(btrim(current_profile.email), ''),
      ''
    ),
    'phone', coalesce(nullif(btrim(current_member.phone), ''), ''),
    'email_from_member', nullif(btrim(current_member.email), '') is not null,
    'phone_from_member', nullif(btrim(current_member.phone), '') is not null
  );
end;
$$;

revoke all on function public.get_my_tournament_registration_identity(uuid)
from public, anon, authenticated;
grant execute on function public.get_my_tournament_registration_identity(uuid)
to authenticated;

commit;
