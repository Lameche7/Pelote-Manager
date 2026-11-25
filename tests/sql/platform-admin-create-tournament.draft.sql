-- Draft: explicit-club creation for the platform lease only.
-- Keep the existing local administrator RPCs unchanged.
create or replace function public.platform_admin_create_tournament(target_club_id uuid, payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
  target_season_id uuid := nullif(payload->>'season_id', '')::uuid;
  target_name text := btrim(coalesce(payload->>'name', ''));
  target_pool_starts_on date := coalesce(
    nullif(payload->>'pool_starts_on', '')::date,
    nullif(payload->>'starts_on', '')::date
  );
  target_pool_ends_on date := coalesce(
    nullif(payload->>'pool_ends_on', '')::date,
    nullif(payload->>'ends_on', '')::date
  );
  target_finals_starts_on date := nullif(payload->>'finals_starts_on', '')::date;
  target_finals_ends_on date := nullif(payload->>'finals_ends_on', '')::date;
  target_starts_on date;
  target_ends_on date;
  target_registration_opens_at timestamptz := nullif(payload->>'registration_opens_at', '')::timestamptz;
  target_registration_closes_at timestamptz := nullif(payload->>'registration_closes_at', '')::timestamptz;
  target_minimum integer := coalesce(nullif(payload->>'minimum_availability_slots', '')::integer, 65);
  target_weekend_minimum integer := coalesce(nullif(payload->>'minimum_weekend_availability_slots', '')::integer, 0);
  target_slot_duration integer := coalesce(nullif(payload->>'slot_duration_minutes', '')::integer, 60);
  target_finals_minimum integer := coalesce(nullif(payload->>'minimum_finals_availability_slots', '')::integer, 35);
  target_fee_cents integer := coalesce(nullif(payload->>'registration_fee_cents', '')::integer, 0);
begin
  if auth.uid() is null or target_club_id is null
    or not coalesce(pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if not coalesce((select (modules->>'tournaments')::boolean
    from pilotoki_private.club_module_profiles where club_id = target_club_id), true) then
    raise exception 'Tournament module disabled' using errcode = '42501';
  end if;

  if target_finals_minimum < 0 then
    raise exception 'Tournament availability settings are invalid' using errcode = '22023';
  end if;
  if target_fee_cents < 0 then
    raise exception 'Tournament registration fee is invalid' using errcode = '22023';
  end if;

  if target_name = ''
    or target_season_id is null
    or target_pool_starts_on is null
    or target_pool_ends_on is null
    or target_registration_opens_at is null
    or target_registration_closes_at is null then
    raise exception 'Tournament fields are incomplete' using errcode = '22023';
  end if;

  if target_pool_ends_on < target_pool_starts_on
    or (target_finals_starts_on is null) <> (target_finals_ends_on is null)
    or (
      target_finals_starts_on is not null
      and (
        target_finals_ends_on < target_finals_starts_on
        or target_finals_starts_on <= target_pool_ends_on
      )
    ) then
    raise exception 'Tournament phase dates are invalid' using errcode = '22023';
  end if;

  if target_registration_closes_at <= target_registration_opens_at then
    raise exception 'Registration dates are invalid' using errcode = '22023';
  end if;

  if target_minimum < 0
    or target_weekend_minimum < 0
    or target_weekend_minimum > target_minimum
    or target_slot_duration < 15
    or target_slot_duration > 240 then
    raise exception 'Tournament availability settings are invalid' using errcode = '22023';
  end if;

  target_starts_on := target_pool_starts_on;
  target_ends_on := coalesce(target_finals_ends_on, target_pool_ends_on);

  if not exists (
    select 1
    from public.club_seasons as season
    where season.id = target_season_id
      and season.club_id = target_club_id
      and season.starts_on <= target_starts_on
      and season.ends_on >= target_ends_on
  ) then
    raise exception 'Tournament must fit inside its season' using errcode = '22023';
  end if;

  insert into public.tournaments (
    club_id,
    season_id,
    name,
    description,
    rules,
    starts_on,
    ends_on,
    pool_starts_on,
    pool_ends_on,
    finals_starts_on,
    finals_ends_on,
    registration_opens_at,
    registration_closes_at,
    minimum_availability_slots,
    minimum_weekend_availability_slots,
    slot_duration_minutes,
    minimum_finals_availability_slots,
    registration_fee_cents,
    created_by,
    updated_by
  )
  values (
    target_club_id,
    target_season_id,
    target_name,
    coalesce(payload->>'description', ''),
    coalesce(payload->>'rules', ''),
    target_starts_on,
    target_ends_on,
    target_pool_starts_on,
    target_pool_ends_on,
    target_finals_starts_on,
    target_finals_ends_on,
    target_registration_opens_at,
    target_registration_closes_at,
    target_minimum,
    target_weekend_minimum,
    target_slot_duration,
    target_finals_minimum,
    target_fee_cents,
    auth.uid(),
    auth.uid()
  )
  returning id into target_id;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    after_status,
    payload,
    created_by
  )
  values (
    target_id,
    'created',
    'preparation',
    jsonb_build_object(
      'name', target_name,
      'pool_starts_on', target_pool_starts_on,
      'pool_ends_on', target_pool_ends_on,
      'finals_starts_on', target_finals_starts_on,
      'finals_ends_on', target_finals_ends_on
    ),
    auth.uid()
  );

  return target_id;
end;
$$;

revoke all on function public.platform_admin_create_tournament(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.platform_admin_create_tournament(uuid, jsonb) to authenticated;
