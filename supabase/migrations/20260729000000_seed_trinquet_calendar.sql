-- Initialise le calendrier de réservation du Pelotaris Club Lourdais.
-- Cette migration est idempotente : elle peut être rejouée sans créer de doublons.

do $$
declare
  trinquet_id uuid;
begin
  select id
  into trinquet_id
  from public.reservable_resources
  where lower(name) = lower('Trinquet Robert Cathala')
  order by created_at
  limit 1;

  if trinquet_id is null then
    insert into public.reservable_resources (
      name,
      description,
      timezone,
      is_active
    ) values (
      'Trinquet Robert Cathala',
      'Terrain principal du Pelotaris Club Lourdais à Lourdes.',
      'Europe/Paris',
      true
    )
    returning id into trinquet_id;
  else
    update public.reservable_resources
    set description = 'Terrain principal du Pelotaris Club Lourdais à Lourdes.',
        timezone = 'Europe/Paris',
        is_active = true,
        updated_at = now()
    where id = trinquet_id;
  end if;

  -- Horaires d’ouverture : du lundi au samedi, de 09 h 30 à 22 h 30.
  -- Le dimanche reste fermé.
  delete from public.resource_opening_hours
  where resource_id = trinquet_id;

  insert into public.resource_opening_hours (
    resource_id,
    weekday,
    opens_at,
    closes_at,
    is_open
  )
  select
    trinquet_id,
    weekday,
    time '09:30',
    time '22:30',
    true
  from generate_series(1, 6) as weekday;
end;
$$;

update public.reservation_settings
set default_duration_minutes = 60,
    booking_step_minutes = 60,
    minimum_notice_minutes = 60,
    licensee_advance_hours = 72,
    public_advance_hours = 48,
    updated_at = now()
where id;
