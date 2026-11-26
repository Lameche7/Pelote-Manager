-- Explicit club scope for team status, deletion and member search.
CREATE OR REPLACE FUNCTION public.admin_set_tournament_team_status_for_club(target_club_id uuid, target_team_id uuid, target_status tournament_team_status)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_team public.tournament_teams;
  current_tournament public.tournaments;
begin
  if auth.uid() is null or target_club_id is null or not coalesce((public.can_administer_club(target_club_id, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id)), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select team.*
  into current_team
  from public.tournament_teams as team
  join public.tournaments as tournament on tournament.id = team.tournament_id
  where team.id = target_team_id
    and tournament.club_id = target_club_id
  for update of team;

  if current_team.id is null then
    raise exception 'Tournament team not found' using errcode = 'P0002';
  end if;

  select tournament.*
  into current_tournament
  from public.tournaments as tournament
  where tournament.id = current_team.tournament_id
  for update;

  if current_tournament.status not in (
    'preparation',
    'configuration',
    'registrations_open',
    'registrations_closed'
  ) then
    raise exception 'Tournament teams are locked at this stage' using errcode = 'P0001';
  end if;

  if target_status = 'accepted'
    and current_team.status not in ('pending', 'accepted')
    and not public.tournament_series_has_capacity(current_team.series_id, current_team.id) then
    raise exception 'Tournament series is full' using errcode = 'P0001';
  end if;

  update public.tournament_teams
  set
    status = target_status,
    validated_by = case when target_status in ('accepted', 'rejected') then auth.uid() else null end,
    validated_at = case when target_status in ('accepted', 'rejected') then now() else null end,
    updated_at = now()
  where id = target_team_id;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    current_team.tournament_id,
    'team_status_changed',
    current_tournament.status,
    current_tournament.status,
    jsonb_build_object(
      'team_id', target_team_id,
      'from', current_team.status,
      'to', target_status
    ),
    auth.uid()
  );
end;
$function$;
revoke all on function public.admin_set_tournament_team_status_for_club(uuid, uuid, public.tournament_team_status) from public, anon;
grant execute on function public.admin_set_tournament_team_status_for_club(uuid, uuid, public.tournament_team_status) to authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_tournament_team_status_v2_for_club(target_club_id uuid, target_team_id uuid, target_status tournament_team_status)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_team public.tournament_teams;
  target_tournament public.tournaments;
  previous_status public.tournament_status;
  pools_invalidated boolean := false;
  preserve_pool_status boolean := false;
  structural_change boolean := false;
begin
  if auth.uid() is null or target_club_id is null or not coalesce((public.can_administer_club(target_club_id, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id)), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select team.*
  into target_team
  from public.tournament_teams as team
  join public.tournaments as tournament on tournament.id = team.tournament_id
  where team.id = target_team_id
    and tournament.club_id = target_club_id
  for update of team;

  if target_team.id is null then
    raise exception 'Tournament team not found' using errcode = 'P0002';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_team.tournament_id
  for update;

  if target_tournament.status not in (
    'preparation',
    'configuration',
    'registrations_open',
    'registrations_closed',
    'pools_generated',
    'pools_validated'
  ) then
    raise exception 'Tournament teams cannot be changed after planning generation'
      using errcode = 'P0001';
  end if;

  previous_status := target_tournament.status;

  if previous_status in ('pools_generated', 'pools_validated') then
    structural_change := (target_team.status = 'accepted')
      is distinct from (target_status = 'accepted');

    if structural_change then
      delete from public.tournament_pools
      where tournament_id = target_tournament.id;

      update public.tournaments
      set
        status = 'registrations_closed',
        updated_by = auth.uid(),
        updated_at = now()
      where id = target_tournament.id;

      pools_invalidated := true;
    else
      update public.tournaments
      set status = 'registrations_closed'
      where id = target_tournament.id;

      preserve_pool_status := true;
    end if;
  end if;

  perform public.admin_set_tournament_team_status_for_club(target_club_id, target_team_id, target_status);

  if preserve_pool_status then
    update public.tournaments
    set
      status = previous_status,
      updated_by = auth.uid(),
      updated_at = now()
    where id = target_tournament.id;
  elsif pools_invalidated then
    insert into public.tournament_audit_log (
      tournament_id,
      action,
      before_status,
      after_status,
      payload,
      created_by
    )
    values (
      target_tournament.id,
      'pools_invalidated_by_team_status_change',
      previous_status,
      'registrations_closed',
      jsonb_build_object(
        'team_id', target_team_id,
        'from', target_team.status,
        'to', target_status
      ),
      auth.uid()
    );
  end if;

  return jsonb_build_object('pools_invalidated', pools_invalidated);
end;
$function$;
revoke all on function public.admin_set_tournament_team_status_v2_for_club(uuid, uuid, public.tournament_team_status) from public, anon;
grant execute on function public.admin_set_tournament_team_status_v2_for_club(uuid, uuid, public.tournament_team_status) to authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_tournament_team_for_club(target_club_id uuid, target_team_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_team public.tournament_teams;
  target_tournament public.tournaments;
  previous_status public.tournament_status;
  pools_invalidated boolean := false;
begin
  if auth.uid() is null or target_club_id is null or not coalesce((public.can_administer_club(target_club_id, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id)), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select team.*
  into target_team
  from public.tournament_teams as team
  join public.tournaments as tournament on tournament.id = team.tournament_id
  where team.id = target_team_id
    and tournament.club_id = target_club_id
  for update of team;

  if target_team.id is null then
    raise exception 'Tournament team not found' using errcode = 'P0002';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_team.tournament_id
  for update;

  if target_tournament.status not in (
    'preparation',
    'configuration',
    'registrations_open',
    'registrations_closed',
    'pools_generated',
    'pools_validated'
  ) then
    raise exception 'Tournament teams cannot be changed after planning generation'
      using errcode = 'P0001';
  end if;

  previous_status := target_tournament.status;

  if previous_status in ('pools_generated', 'pools_validated')
    and target_team.status = 'accepted' then
    delete from public.tournament_pools
    where tournament_id = target_tournament.id;

    update public.tournaments
    set
      status = 'registrations_closed',
      updated_by = auth.uid(),
      updated_at = now()
    where id = target_tournament.id;

    pools_invalidated := true;
  end if;

  delete from public.tournament_teams
  where id = target_team.id;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    target_tournament.id,
    'team_deleted_by_admin',
    previous_status,
    case
      when pools_invalidated then 'registrations_closed'::public.tournament_status
      else previous_status
    end,
    jsonb_build_object(
      'team_id', target_team.id,
      'series_id', target_team.series_id,
      'team_status', target_team.status,
      'submitted_by', target_team.submitted_by,
      'pools_invalidated', pools_invalidated
    ),
    auth.uid()
  );

  return jsonb_build_object('pools_invalidated', pools_invalidated);
end;
$function$;
revoke all on function public.admin_delete_tournament_team_for_club(uuid, uuid) from public, anon;
grant execute on function public.admin_delete_tournament_team_for_club(uuid, uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.admin_search_tournament_members_for_club(target_club_id uuid, target_tournament_id uuid, search_text text, excluded_team_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  normalized_search text := lower(btrim(coalesce(search_text, '')));
begin
  if auth.uid() is null or target_club_id is null or not coalesce((public.can_administer_club(target_club_id, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id)), false) then
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
$function$;
revoke all on function public.admin_search_tournament_members_for_club(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.admin_search_tournament_members_for_club(uuid, uuid, text, uuid) to authenticated;

