begin;

create or replace function public.admin_search_tournament_account_candidates(
  target_external_identity_id uuid,
  search_term text default ''
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_club uuid := public.admin_current_club_id();
  target_identity public.tournament_external_player_identities%rowtype;
  query_text text := btrim(coalesce(search_term, ''));
begin
  if current_club is null
    or not public.has_club_permission(current_club, 'tournaments.manage')
  then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select identity.*
  into target_identity
  from public.tournament_external_player_identities as identity
  where identity.id = target_external_identity_id
    and exists (
      select 1
      from public.tournament_team_players as player
      join public.tournament_teams as team on team.id = player.team_id
      join public.tournaments as tournament on tournament.id = player.tournament_id
      where player.external_identity_id = identity.id
        and tournament.club_id = current_club
        and team.status in ('pending', 'accepted')
    );

  if target_identity.id is null then
    raise exception 'External participation not found' using errcode = 'P0002';
  end if;

  return coalesce((
    with candidates as (
      select
        profile.id,
        profile.email,
        coalesce(nullif(btrim(profile.first_name), ''), member.first_name) as first_name,
        coalesce(nullif(btrim(profile.last_name), ''), member.last_name) as last_name,
        profile.display_name,
        profile.member_id,
        public.normalize_member_identity(
          coalesce(nullif(btrim(profile.first_name), ''), member.first_name, '')
        ) = target_identity.first_name_normalized
          and public.normalize_member_identity(
            coalesce(nullif(btrim(profile.last_name), ''), member.last_name, '')
          ) = target_identity.last_name_normalized as exact_name
      from public.profiles as profile
      left join public.club_members as member on member.id = profile.member_id
      where (
        query_text = ''
        and public.normalize_member_identity(
          coalesce(nullif(btrim(profile.first_name), ''), member.first_name, '')
        ) = target_identity.first_name_normalized
        and public.normalize_member_identity(
          coalesce(nullif(btrim(profile.last_name), ''), member.last_name, '')
        ) = target_identity.last_name_normalized
      ) or (
        query_text <> ''
        and (
          coalesce(profile.first_name, '') ilike '%' || query_text || '%'
          or coalesce(profile.last_name, '') ilike '%' || query_text || '%'
          or coalesce(profile.display_name, '') ilike '%' || query_text || '%'
          or coalesce(profile.email, '') ilike '%' || query_text || '%'
          or coalesce(member.first_name, '') ilike '%' || query_text || '%'
          or coalesce(member.last_name, '') ilike '%' || query_text || '%'
        )
      )
      order by
        case when
          public.normalize_member_identity(
            coalesce(nullif(btrim(profile.first_name), ''), member.first_name, '')
          ) = target_identity.first_name_normalized
          and public.normalize_member_identity(
            coalesce(nullif(btrim(profile.last_name), ''), member.last_name, '')
          ) = target_identity.last_name_normalized
        then 0 else 1 end,
        lower(coalesce(profile.last_name, member.last_name, profile.display_name, profile.email, ''))
      limit 25
    )
    select jsonb_agg(
      jsonb_build_object(
        'id', candidate.id,
        'email', candidate.email,
        'firstName', candidate.first_name,
        'lastName', candidate.last_name,
        'displayName', candidate.display_name,
        'memberId', candidate.member_id,
        'exactName', candidate.exact_name
      )
      order by
        case when candidate.exact_name then 0 else 1 end,
        lower(coalesce(candidate.last_name, candidate.display_name, candidate.email, ''))
    )
    from candidates as candidate
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_search_tournament_account_candidates(uuid, text)
from public, anon, authenticated;
grant execute on function public.admin_search_tournament_account_candidates(uuid, text)
to authenticated;

commit;
