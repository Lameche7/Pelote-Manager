-- Draft: tournament-scoped candidate search; not a network account directory.
CREATE OR REPLACE FUNCTION public.admin_search_tournament_account_candidates_for_club(target_club_id uuid, target_tournament_id uuid, target_external_identity_id uuid, search_term text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_club uuid := target_club_id;
  target_identity public.tournament_external_player_identities%rowtype;
  query_text text := btrim(coalesce(search_term, ''));
begin
  if auth.uid() is null or current_club is null
    or not coalesce((public.can_administer_club(current_club, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), current_club)), false)
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
        and tournament.id = target_tournament_id
        and team.tournament_id = target_tournament_id
        and team.status in ('pending', 'accepted')
    );

  if target_identity.id is null then
    raise exception 'External participation not found' using errcode = 'P0002';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', profile.id,
        'email', profile.email,
        'firstName', coalesce(nullif(btrim(profile.first_name), ''), member.first_name),
        'lastName', coalesce(nullif(btrim(profile.last_name), ''), member.last_name),
        'displayName', profile.display_name,
        'memberId', public.profile_club_member_id(profile.id, current_club),
        'emailConfirmed', candidate_auth.email_confirmed_at is not null,
        'exactName',
          public.normalize_member_identity(
            coalesce(nullif(btrim(profile.first_name), ''), member.first_name, '')
          ) = target_identity.first_name_normalized
          and public.normalize_member_identity(
            coalesce(nullif(btrim(profile.last_name), ''), member.last_name, '')
          ) = target_identity.last_name_normalized
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
    )
    from public.profiles as profile
    join auth.users as candidate_auth on candidate_auth.id = profile.id
    left join public.club_members as member
      on member.id = public.profile_club_member_id(profile.id, current_club)
    where (
      (public.normalize_member_identity(coalesce(nullif(btrim(profile.first_name), ''), member.first_name, '')) = target_identity.first_name_normalized
       and public.normalize_member_identity(coalesce(nullif(btrim(profile.last_name), ''), member.last_name, '')) = target_identity.last_name_normalized)
      or exists (
        select 1 from public.tournament_team_players p
        join public.tournament_teams t on t.id = p.team_id and t.tournament_id = target_tournament_id
        where p.tournament_id = target_tournament_id and p.external_identity_id = target_identity.id
          and t.status in ('pending', 'accepted')
          and nullif(btrim(p.email), '') is not null
          and lower(btrim(p.email)) = lower(btrim(profile.email))
      )
    ) and ((
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
    )
    limit 25
  ), '[]'::jsonb);
end;
$function$;
revoke all on function public.admin_search_tournament_account_candidates_for_club(uuid, uuid, uuid, text) from public, anon, authenticated;
