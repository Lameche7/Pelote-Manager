begin;

create or replace function public.admin_create_permanent_slot(
  target_resource_id uuid,
  target_label text,
  target_weekday smallint,
  target_starts_at time,
  target_ends_at time,
  target_valid_from date,
  target_valid_until date,
  target_management_window_hours integer,
  target_primary_profile_id uuid,
  target_manager_profile_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  resource_timezone text;
  default_duration integer;
  requested_duration integer;
  materialization_from date;
  first_date date;
  occurrence_date date;
  occurrence_starts_at timestamptz;
  occurrence_ends_at timestamptz;
  created_slot_id uuid;
  created_occupation_id uuid;
  manager_profile_id uuid;
begin
  if not public.has_club_permission(target_club_id, 'reservations.manage') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  if btrim(coalesce(target_label, '')) = '' then
    raise exception 'Libellé du créneau permanent obligatoire' using errcode = '22023';
  end if;

  if target_weekday is null or target_weekday not between 1 and 7 then
    raise exception 'Jour du créneau permanent invalide' using errcode = '22023';
  end if;

  if target_starts_at is null then
    raise exception 'Heure de début du créneau permanent obligatoire' using errcode = '22023';
  end if;

  if target_ends_at is null then
    raise exception 'Heure de fin du créneau permanent obligatoire' using errcode = '22023';
  end if;

  if target_ends_at <= target_starts_at then
    raise exception 'Heure de fin du créneau permanent doit être après l heure de début' using errcode = '22023';
  end if;

  if target_valid_from is null then
    raise exception 'Date de début du créneau permanent obligatoire' using errcode = '22023';
  end if;

  if target_valid_until is null then
    raise exception 'Date de fin du créneau permanent obligatoire' using errcode = '22023';
  end if;

  if target_valid_until < target_valid_from then
    raise exception 'Date de fin du créneau permanent antérieure à la date de début' using errcode = '22023';
  end if;

  if target_valid_until < current_date then
    raise exception 'Date de fin du créneau permanent déjà passée' using errcode = '22023';
  end if;

  if target_valid_until > target_valid_from + 730 then
    raise exception 'Période du créneau permanent supérieure à deux ans' using errcode = '22023';
  end if;

  if target_management_window_hours is null
    or target_management_window_hours not between 1 and 168 then
    raise exception 'Délai de gestion du créneau permanent invalide' using errcode = '22023';
  end if;

  select resource.timezone
  into resource_timezone
  from public.reservable_resources as resource
  where resource.id = target_resource_id
    and resource.club_id = target_club_id
    and resource.is_active;

  if resource_timezone is null then
    raise exception 'Terrain invalide' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles where id = target_primary_profile_id
  ) then
    raise exception 'Le titulaire principal doit posséder un compte PILOTOKI'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(coalesce(target_manager_profile_ids, '{}'::uuid[]))
      as requested_manager(profile_id)
    left join public.profiles as profile
      on profile.id = requested_manager.profile_id
    where profile.id is null
  ) then
    raise exception 'Un gestionnaire sélectionné ne possède pas de compte PILOTOKI'
      using errcode = '22023';
  end if;

  select settings.default_duration_minutes
  into default_duration
  from public.reservation_settings as settings
  where settings.id;

  requested_duration := extract(epoch from (target_ends_at - target_starts_at))::integer / 60;

  if requested_duration <> default_duration then
    raise exception 'Le créneau permanent doit avoir la durée de réservation configurée (% min)',
      default_duration using errcode = '22023';
  end if;

  insert into public.permanent_slots (
    club_id,
    resource_id,
    label,
    weekday,
    starts_at,
    ends_at,
    valid_from,
    valid_until,
    management_window_hours,
    created_by,
    updated_by
  ) values (
    target_club_id,
    target_resource_id,
    btrim(target_label),
    target_weekday,
    target_starts_at,
    target_ends_at,
    target_valid_from,
    target_valid_until,
    target_management_window_hours,
    auth.uid(),
    auth.uid()
  ) returning id into created_slot_id;

  insert into public.permanent_slot_managers (
    permanent_slot_id,
    profile_id,
    is_primary
  ) values (
    created_slot_id,
    target_primary_profile_id,
    true
  );

  for manager_profile_id in
    select distinct requested_manager.profile_id
    from unnest(coalesce(target_manager_profile_ids, '{}'::uuid[]))
      as requested_manager(profile_id)
    where requested_manager.profile_id <> target_primary_profile_id
  loop
    insert into public.permanent_slot_managers (
      permanent_slot_id,
      profile_id,
      is_primary
    ) values (
      created_slot_id,
      manager_profile_id,
      false
    );
  end loop;

  materialization_from := greatest(target_valid_from, current_date);
  first_date := materialization_from + (
    (target_weekday::integer - extract(isodow from materialization_from)::integer + 7) % 7
  );
  occurrence_date := first_date;

  while occurrence_date <= target_valid_until loop
    occurrence_starts_at := (occurrence_date + target_starts_at) at time zone resource_timezone;
    occurrence_ends_at := (occurrence_date + target_ends_at) at time zone resource_timezone;

    if occurrence_ends_at > now() then
      if exists (
        select 1
        from public.calendar_occupations as occupation
        where occupation.resource_id = target_resource_id
          and occupation.cancelled_at is null
          and tstzrange(occupation.starts_at, occupation.ends_at, '[)')
            && tstzrange(occurrence_starts_at, occurrence_ends_at, '[)')
      ) then
        raise exception 'Impossible de créer le créneau permanent : conflit le %',
          to_char(occurrence_date, 'DD/MM/YYYY')
          using errcode = '23P01';
      end if;

      insert into public.calendar_occupations (
        resource_id,
        occupation_type,
        title,
        starts_at,
        ends_at,
        created_by,
        updated_by
      ) values (
        target_resource_id,
        'private_use'::public.occupation_type,
        'Créneau permanent · ' || btrim(target_label),
        occurrence_starts_at,
        occurrence_ends_at,
        auth.uid(),
        auth.uid()
      ) returning id into created_occupation_id;

      insert into public.permanent_slot_occurrences (
        permanent_slot_id,
        occurrence_date,
        occupation_id
      ) values (
        created_slot_id,
        occurrence_date,
        created_occupation_id
      );
    end if;

    occurrence_date := occurrence_date + 7;
  end loop;

  insert into public.permanent_slot_audit_log (
    permanent_slot_id,
    action,
    actor_id
  ) values (
    created_slot_id,
    'slot_created',
    auth.uid()
  );

  return created_slot_id;
end;
$$;

commit;
