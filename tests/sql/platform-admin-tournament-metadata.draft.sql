-- Draft: explicitly scoped refereeing and Network metadata.
-- Network specialty is distinct from sporting-rule specialty.

create or replace function public.platform_admin_get_tournament_refereeing(target_club_id uuid, target_id uuid)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare result boolean;
begin
  if auth.uid() is null or target_club_id is null
    or not coalesce(pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if not coalesce((select (modules->>'tournaments')::boolean
    from pilotoki_private.club_module_profiles where club_id = target_club_id), true) then
    raise exception 'Tournament module disabled' using errcode = '42501';
  end if;
  select coalesce(t.refereeing_enabled, false) into result
  from public.tournaments t where t.id = target_id and t.club_id = target_club_id;
  if not found then raise exception 'Tournament not found' using errcode = 'P0002'; end if;
  return result;
end;
$$;
revoke all on function public.platform_admin_get_tournament_refereeing(uuid, uuid) from public, anon, authenticated;
grant execute on function public.platform_admin_get_tournament_refereeing(uuid, uuid) to authenticated;

create or replace function public.platform_admin_set_tournament_refereeing(target_club_id uuid, target_id uuid, target_enabled boolean)
returns void language plpgsql volatile security definer set search_path = ''
as $$
begin
  if auth.uid() is null or target_club_id is null
    or not coalesce(pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if not coalesce((select (modules->>'tournaments')::boolean
    from pilotoki_private.club_module_profiles where club_id = target_club_id), true) then
    raise exception 'Tournament module disabled' using errcode = '42501';
  end if;
  if target_enabled is null then raise exception 'Invalid refereeing setting' using errcode = '22023'; end if;
  if target_enabled and not coalesce((select (modules->>'tournamentRefereeing')::boolean
    from pilotoki_private.club_module_profiles where club_id = target_club_id), true) then
    raise exception 'Refereeing module disabled' using errcode = '42501';
  end if;
  update public.tournaments set refereeing_enabled = target_enabled, updated_at = now()
  where id = target_id and club_id = target_club_id;
  if not found then raise exception 'Tournament not found' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.platform_admin_set_tournament_refereeing(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.platform_admin_set_tournament_refereeing(uuid, uuid, boolean) to authenticated;

create or replace function public.platform_admin_get_tournament_network_specialty(target_club_id uuid, target_id uuid)
returns text language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or target_club_id is null
    or not coalesce(pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if not coalesce((select (modules->>'tournaments')::boolean
    from pilotoki_private.club_module_profiles where club_id = target_club_id), true) then
    raise exception 'Tournament module disabled' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tournaments t
    where t.id = target_id and t.club_id = target_club_id) then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;
  return coalesce((select p.specialty from public.network_tournament_profiles p
    where p.tournament_id = target_id), '');
end;
$$;
revoke all on function public.platform_admin_get_tournament_network_specialty(uuid, uuid) from public, anon, authenticated;
grant execute on function public.platform_admin_get_tournament_network_specialty(uuid, uuid) to authenticated;

create or replace function public.platform_admin_set_tournament_network_specialty(target_club_id uuid, target_id uuid, target_specialty text)
returns void language plpgsql volatile security definer set search_path = ''
as $$
begin
  if auth.uid() is null or target_club_id is null
    or not coalesce(pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if not coalesce((select (modules->>'tournaments')::boolean
    from pilotoki_private.club_module_profiles where club_id = target_club_id), true) then
    raise exception 'Tournament module disabled' using errcode = '42501';
  end if;
  perform 1 from public.tournaments t where t.id = target_id and t.club_id = target_club_id for update;
  if not found then raise exception 'Tournament not found' using errcode = 'P0002'; end if;
  if target_specialty is not null and target_specialty not in
    ('', 'Trinquet', 'Mur à gauche', 'Fronton', 'Place libre', 'Autre') then
    raise exception 'Invalid network specialty' using errcode = '22023';
  end if;
  insert into public.network_tournament_profiles (tournament_id, specialty, updated_at)
  values (target_id, nullif(target_specialty, ''), now())
  on conflict (tournament_id) do update set specialty = excluded.specialty, updated_at = now();
end;
$$;
revoke all on function public.platform_admin_set_tournament_network_specialty(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.platform_admin_set_tournament_network_specialty(uuid, uuid, text) to authenticated;
