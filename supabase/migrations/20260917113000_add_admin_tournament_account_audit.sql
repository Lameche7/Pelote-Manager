begin;

create or replace function public.admin_list_tournament_account_audit(
  target_tournament_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_club uuid := public.admin_current_club_id();
begin
  if current_club is null
    or not public.has_club_permission(current_club, 'tournaments.manage')
  then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.tournaments as tournament
    where tournament.id = target_tournament_id
      and tournament.club_id = current_club
  ) then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  return coalesce((
    with identities as (
      select distinct
        identity.id,
        identity.first_name,
        identity.last_name,
        identity.first_name_normalized,
        identity.last_name_normalized,
        identity.status,
        identity.profile_id,
        identity.member_id
      from public.tournament_external_player_identities as identity
      join public.tournament_team_players as player
        on player.external_identity_id = identity.id
      join public.tournament_teams as team
        on team.id = player.team_id
       and team.tournament_id = target_tournament_id
      where player.tournament_id = target_tournament_id
        and team.status in ('pending', 'accepted')
    )
    select jsonb_agg(
      jsonb_build_object(
        'externalIdentityId', identity.id,
        'firstName', identity.first_name,
        'lastName', identity.last_name,
        'status', case
          when identity.status = 'verified' and identity.profile_id is not null
            then 'recognized'
          when jsonb_array_length(candidates.items) > 0
            then 'probable'
          else 'unmatched'
        end,
        'linkedProfile', case
          when linked_profile.id is null then null
          else jsonb_build_object(
            'id', linked_profile.id,
            'email', linked_profile.email,
            'firstName', linked_profile.first_name,
            'lastName', linked_profile.last_name,
            'displayName', linked_profile.display_name
          )
        end,
        'participations', participations.items,
        'candidates', candidates.items
      )
      order by identity.last_name_normalized, identity.first_name_normalized
    )
    from identities as identity
    left join public.profiles as linked_profile
      on linked_profile.id = identity.profile_id
    cross join lateral (
      select coalesce(jsonb_agg(item order by item->>'seriesName'), '[]'::jsonb) as items
      from (
        select distinct jsonb_build_object(
          'teamId', team.id,
          'seriesName', series.name,
          'role', player.role,
          'partnerName', concat_ws(' ', partner.first_name, partner.last_name)
        ) as item
        from public.tournament_team_players as player
        join public.tournament_teams as team on team.id = player.team_id
        join public.tournament_series as series on series.id = team.series_id
        left join lateral (
          select other.first_name, other.last_name
          from public.tournament_team_players as other
          where other.team_id = team.id
            and other.id <> player.id
          order by other.display_order, other.id
          limit 1
        ) as partner on true
        where player.external_identity_id = identity.id
          and player.tournament_id = target_tournament_id
          and team.status in ('pending', 'accepted')
      ) as participation_rows
    ) as participations
    cross join lateral (
      select coalesce(jsonb_agg(candidate order by candidate->>'matchRank', candidate->>'lastName'), '[]'::jsonb) as items
      from (
        select distinct jsonb_build_object(
          'id', profile.id,
          'email', profile.email,
          'firstName', coalesce(nullif(btrim(profile.first_name), ''), member.first_name),
          'lastName', coalesce(nullif(btrim(profile.last_name), ''), member.last_name),
          'displayName', profile.display_name,
          'matchReason', case
            when exists (
              select 1
              from public.tournament_team_players as player_email
              where player_email.external_identity_id = identity.id
                and player_email.tournament_id = target_tournament_id
                and nullif(btrim(player_email.email), '') is not null
                and lower(btrim(player_email.email)) = lower(btrim(profile.email))
            ) then 'email'
            else 'name'
          end,
          'matchRank', case
            when exists (
              select 1
              from public.tournament_team_players as player_email
              where player_email.external_identity_id = identity.id
                and player_email.tournament_id = target_tournament_id
                and nullif(btrim(player_email.email), '') is not null
                and lower(btrim(player_email.email)) = lower(btrim(profile.email))
            ) then '0'
            else '1'
          end
        ) as candidate
        from public.profiles as profile
        left join public.club_members as member on member.id = profile.member_id
        where identity.profile_id is null
          and (
            exists (
              select 1
              from public.tournament_team_players as player_email
              where player_email.external_identity_id = identity.id
                and player_email.tournament_id = target_tournament_id
                and nullif(btrim(player_email.email), '') is not null
                and lower(btrim(player_email.email)) = lower(btrim(profile.email))
            )
            or (
              public.normalize_member_identity(
                coalesce(nullif(btrim(profile.first_name), ''), member.first_name, '')
              ) = identity.first_name_normalized
              and public.normalize_member_identity(
                coalesce(nullif(btrim(profile.last_name), ''), member.last_name, '')
              ) = identity.last_name_normalized
            )
          )
        limit 10
      ) as candidate_rows
    ) as candidates
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_list_tournament_account_audit(uuid)
from public, anon, authenticated;
grant execute on function public.admin_list_tournament_account_audit(uuid)
to authenticated;

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
    select jsonb_agg(
      jsonb_build_object(
        'id', profile.id,
        'email', profile.email,
        'firstName', coalesce(nullif(btrim(profile.first_name), ''), member.first_name),
        'lastName', coalesce(nullif(btrim(profile.last_name), ''), member.last_name),
        'displayName', profile.display_name,
        'memberId', profile.member_id,
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
    limit 25
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_search_tournament_account_candidates(uuid, text)
from public, anon, authenticated;
grant execute on function public.admin_search_tournament_account_candidates(uuid, text)
to authenticated;

create or replace function public.admin_link_tournament_account(
  target_external_identity_id uuid,
  target_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  current_club uuid := public.admin_current_club_id();
  target_identity public.tournament_external_player_identities%rowtype;
  target_profile public.profiles%rowtype;
  tournament_row record;
begin
  if actor_id is null
    or current_club is null
    or not public.has_club_permission(current_club, 'tournaments.manage')
  then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select identity.*
  into target_identity
  from public.tournament_external_player_identities as identity
  where identity.id = target_external_identity_id
  for update;

  if target_identity.id is null then
    raise exception 'External participation not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.tournament_team_players as player
    join public.tournaments as tournament on tournament.id = player.tournament_id
    where player.external_identity_id = target_identity.id
      and tournament.club_id = current_club
  ) then
    raise exception 'External participation not found' using errcode = 'P0002';
  end if;

  select profile.*
  into target_profile
  from public.profiles as profile
  where profile.id = target_profile_id;

  if target_profile.id is null then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  if target_identity.status = 'verified'
    and target_identity.profile_id is not null
    and target_identity.profile_id <> target_profile.id
  then
    raise exception 'External participation is already linked to another account'
      using errcode = '23505';
  end if;

  if target_identity.status = 'verified'
    and target_identity.profile_id = target_profile.id
  then
    return jsonb_build_object('linked', true, 'profileId', target_profile.id);
  end if;

  update public.tournament_external_player_identities
  set
    profile_id = target_profile.id,
    member_id = target_profile.member_id,
    status = 'verified',
    verification_method = 'admin_manual',
    verified_at = now(),
    verified_by = actor_id,
    updated_at = now()
  where id = target_identity.id;

  for tournament_row in
    select distinct tournament.id, tournament.status
    from public.tournament_team_players as player
    join public.tournaments as tournament on tournament.id = player.tournament_id
    where player.external_identity_id = target_identity.id
      and tournament.club_id = current_club
  loop
    insert into public.tournament_audit_log (
      tournament_id,
      action,
      before_status,
      after_status,
      payload,
      created_by
    ) values (
      tournament_row.id,
      'external_identity_admin_linked',
      tournament_row.status,
      tournament_row.status,
      jsonb_build_object(
        'externalIdentityId', target_identity.id,
        'profileId', target_profile.id
      ),
      actor_id
    );
  end loop;

  return jsonb_build_object(
    'linked', true,
    'profileId', target_profile.id,
    'externalIdentityId', target_identity.id
  );
end;
$$;

revoke all on function public.admin_link_tournament_account(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.admin_link_tournament_account(uuid, uuid)
to authenticated;

commit;
