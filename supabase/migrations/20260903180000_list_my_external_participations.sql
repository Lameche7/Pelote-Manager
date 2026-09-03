begin;

-- PR131 — afficher les participations externes déjà rattachées au compte.
--
-- Cette lecture est réservée au profil connecté et ne renvoie que le contexte
-- sportif utile à l'utilisateur : tournoi, série, partenaire et poste.
-- Aucune coordonnée importée ni donnée privée d'un autre compte n'est exposée.

create or replace function public.get_my_external_participations()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_profile_id uuid := auth.uid();
  current_member_id uuid;
begin
  if current_profile_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select profile.member_id
  into current_member_id
  from public.profiles as profile
  where profile.id = current_profile_id;

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
      where identity.status = 'verified'
        and (
          identity.profile_id = current_profile_id
          or (
            current_member_id is not null
            and identity.member_id = current_member_id
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

comment on function public.get_my_external_participations() is
  'Liste les participations externes déjà rattachées au compte connecté, sans exposer de coordonnées importées.';

commit;
