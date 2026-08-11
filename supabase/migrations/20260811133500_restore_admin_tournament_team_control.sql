begin;

-- PR72 — redonne à l'administrateur la main sur les équipes inscrites
-- jusqu'à la validation des poules, sans laisser un état métier incohérent.
-- Les modifications non structurelles conservent les poules existantes.
-- Les modifications structurelles (ajout, changement de série/statut accepté,
-- suppression d'une équipe acceptée) invalident les poules et ramènent le
-- tournoi à registrations_closed afin qu'elles soient régénérées proprement.

create or replace function public.admin_save_tournament_team_v4(
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
  target_tournament public.tournaments;
  existing_team public.tournament_teams;
  previous_status public.tournament_status;
  requested_series_id uuid := nullif(payload->>'series_id', '')::uuid;
  requested_status text := coalesce(nullif(payload->>'status', ''), 'accepted');
  saved_team_id uuid;
  pools_invalidated boolean := false;
  preserve_pool_status boolean := false;
  structural_change boolean := false;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id
    and tournament.club_id = target_club_id
  for update;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

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

  if target_team_id is not null then
    select team.*
    into existing_team
    from public.tournament_teams as team
    where team.id = target_team_id
      and team.tournament_id = target_tournament.id
    for update;

    if existing_team.id is null then
      raise exception 'Tournament team not found' using errcode = 'P0002';
    end if;
  end if;

  if previous_status in ('pools_generated', 'pools_validated') then
    structural_change := target_team_id is null
      or existing_team.series_id is distinct from requested_series_id
      or existing_team.status::text is distinct from requested_status;

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
      -- Les RPC historiques validées bloquent après registrations_closed.
      -- On ouvre uniquement une fenêtre transactionnelle interne, puis on
      -- restitue le statut de poules une fois la modification réussie.
      update public.tournaments
      set status = 'registrations_closed'
      where id = target_tournament.id;

      preserve_pool_status := true;
    end if;
  end if;

  saved_team_id := public.admin_save_tournament_team_v3(
    target_tournament_id,
    target_team_id,
    payload
  );

  if preserve_pool_status then
    update public.tournaments
    set
      status = previous_status,
      updated_by = auth.uid(),
      updated_at = now()
    where id = target_tournament.id;

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
      'team_updated_with_pools_preserved',
      previous_status,
      previous_status,
      jsonb_build_object('team_id', saved_team_id),
      auth.uid()
    );
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
      'pools_invalidated_by_team_change',
      previous_status,
      'registrations_closed',
      jsonb_build_object(
        'team_id', saved_team_id,
        'reason', case
          when target_team_id is null then 'team_added'
          when existing_team.series_id is distinct from requested_series_id then 'series_changed'
          else 'team_status_changed'
        end
      ),
      auth.uid()
    );
  end if;

  return jsonb_build_object(
    'team_id', saved_team_id,
    'pools_invalidated', pools_invalidated
  );
end;
$$;

create or replace function public.admin_set_tournament_team_status_v2(
  target_team_id uuid,
  target_status public.tournament_team_status
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_team public.tournament_teams;
  target_tournament public.tournaments;
  previous_status public.tournament_status;
  pools_invalidated boolean := false;
  preserve_pool_status boolean := false;
  structural_change boolean := false;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
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

  perform public.admin_set_tournament_team_status(target_team_id, target_status);

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
$$;

create or replace function public.admin_delete_tournament_team(
  target_team_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_team public.tournament_teams;
  target_tournament public.tournaments;
  previous_status public.tournament_status;
  pools_invalidated boolean := false;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
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
$$;

revoke all on function public.admin_save_tournament_team_v4(uuid, uuid, jsonb)
from public, anon, authenticated;
revoke all on function public.admin_set_tournament_team_status_v2(uuid, public.tournament_team_status)
from public, anon, authenticated;
revoke all on function public.admin_delete_tournament_team(uuid)
from public, anon, authenticated;

-- Les anciens points d'écriture restent internes aux wrappers SECURITY DEFINER.
revoke all on function public.admin_set_tournament_team_status(uuid, public.tournament_team_status)
from authenticated;
revoke all on function public.admin_save_tournament_team_v3(uuid, uuid, jsonb)
from authenticated;

grant execute on function public.admin_save_tournament_team_v4(uuid, uuid, jsonb)
to authenticated;
grant execute on function public.admin_set_tournament_team_status_v2(uuid, public.tournament_team_status)
to authenticated;
grant execute on function public.admin_delete_tournament_team(uuid)
to authenticated;

commit;
