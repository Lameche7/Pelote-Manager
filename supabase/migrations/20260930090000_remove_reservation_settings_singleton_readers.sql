begin;

CREATE OR REPLACE FUNCTION public.admin_create_permanent_slot(target_resource_id uuid, target_label text, target_weekday smallint, target_starts_at time without time zone, target_ends_at time without time zone, target_valid_from date, target_valid_until date, target_management_window_hours integer, target_primary_profile_id uuid, target_manager_profile_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  from public.club_reservation_settings as settings
  where settings.club_id = target_club_id;

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
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_permanent_slot(target_permanent_slot_id uuid, target_resource_id uuid, target_label text, target_weekday smallint, target_starts_at time without time zone, target_ends_at time without time zone, target_valid_from date, target_valid_until date, target_management_window_hours integer, target_primary_profile_id uuid, target_manager_profile_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_club_id uuid := public.admin_current_club_id();
  current_slot public.permanent_slots%rowtype;
  resource_timezone text;
  default_duration integer;
  requested_duration integer;
  shape_changed boolean;
  materialization_from date;
  first_date date;
  occurrence_date date;
  occurrence_starts_at timestamptz;
  occurrence_ends_at timestamptz;
  existing_occurrence_id uuid;
  existing_occupation_id uuid;
  existing_status public.permanent_slot_occurrence_status;
  existing_occupation_ends_at timestamptz;
  created_occupation_id uuid;
  manager_profile_id uuid;
begin
  if not public.has_club_permission(target_club_id, 'reservations.manage') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  select slot.*
  into current_slot
  from public.permanent_slots as slot
  where slot.id = target_permanent_slot_id
    and slot.club_id = target_club_id
  for update;

  if current_slot.id is null then
    raise exception 'Créneau permanent introuvable' using errcode = 'P0002';
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
  from public.club_reservation_settings as settings
  where settings.club_id = target_club_id;

  requested_duration := extract(epoch from (target_ends_at - target_starts_at))::integer / 60;

  if requested_duration <> default_duration then
    raise exception 'Le créneau permanent doit avoir la durée de réservation configurée (% min)',
      default_duration using errcode = '22023';
  end if;

  shape_changed := current_slot.resource_id <> target_resource_id
    or current_slot.weekday <> target_weekday
    or current_slot.starts_at <> target_starts_at
    or current_slot.ends_at <> target_ends_at;

  if current_slot.is_active then
    materialization_from := greatest(target_valid_from, current_date);
    first_date := materialization_from + (
      (target_weekday::integer - extract(isodow from materialization_from)::integer + 7) % 7
    );
    occurrence_date := first_date;

    while occurrence_date <= target_valid_until loop
      occurrence_starts_at := (occurrence_date + target_starts_at) at time zone resource_timezone;
      occurrence_ends_at := (occurrence_date + target_ends_at) at time zone resource_timezone;

      if occurrence_starts_at > now() and exists (
        select 1
        from public.calendar_occupations as occupation
        where occupation.resource_id = target_resource_id
          and occupation.cancelled_at is null
          and tstzrange(occupation.starts_at, occupation.ends_at, '[)')
            && tstzrange(occurrence_starts_at, occurrence_ends_at, '[)')
          and not exists (
            select 1
            from public.permanent_slot_occurrences as own_occurrence
            where own_occurrence.permanent_slot_id = target_permanent_slot_id
              and own_occurrence.occupation_id = occupation.id
          )
      ) then
        raise exception 'Impossible de modifier le créneau permanent : conflit le %',
          to_char(occurrence_date, 'DD/MM/YYYY')
          using errcode = '23P01';
      end if;

      occurrence_date := occurrence_date + 7;
    end loop;
  end if;

  update public.permanent_slots
  set resource_id = target_resource_id,
      label = btrim(target_label),
      weekday = target_weekday,
      starts_at = target_starts_at,
      ends_at = target_ends_at,
      valid_from = target_valid_from,
      valid_until = target_valid_until,
      management_window_hours = target_management_window_hours,
      updated_at = now(),
      updated_by = auth.uid()
  where id = target_permanent_slot_id;

  delete from public.permanent_slot_managers
  where permanent_slot_id = target_permanent_slot_id;

  insert into public.permanent_slot_managers (
    permanent_slot_id,
    profile_id,
    is_primary
  ) values (
    target_permanent_slot_id,
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
      target_permanent_slot_id,
      manager_profile_id,
      false
    );
  end loop;

  if current_slot.is_active then
    if shape_changed then
      update public.calendar_occupations as occupation
      set cancelled_at = coalesce(occupation.cancelled_at, now()),
          updated_at = now(),
          updated_by = auth.uid()
      from public.permanent_slot_occurrences as occurrence
      where occurrence.permanent_slot_id = target_permanent_slot_id
        and occurrence.occupation_id = occupation.id
        and occupation.starts_at > now();
    end if;

    materialization_from := greatest(target_valid_from, current_date);
    first_date := materialization_from + (
      (target_weekday::integer - extract(isodow from materialization_from)::integer + 7) % 7
    );
    occurrence_date := first_date;

    while occurrence_date <= target_valid_until loop
      occurrence_starts_at := (occurrence_date + target_starts_at) at time zone resource_timezone;
      occurrence_ends_at := (occurrence_date + target_ends_at) at time zone resource_timezone;

      if occurrence_starts_at > now() then
        existing_occurrence_id := null;
        existing_occupation_id := null;
        existing_status := null;
        existing_occupation_ends_at := null;

        select
          occurrence.id,
          occurrence.occupation_id,
          occurrence.status,
          occupation.ends_at
        into
          existing_occurrence_id,
          existing_occupation_id,
          existing_status,
          existing_occupation_ends_at
        from public.permanent_slot_occurrences as occurrence
        join public.calendar_occupations as occupation
          on occupation.id = occurrence.occupation_id
        where occurrence.permanent_slot_id = target_permanent_slot_id
          and occurrence.occurrence_date = occurrence_date;

        if existing_occurrence_id is not null then
          if shape_changed and existing_occupation_ends_at <= now() then
            raise exception 'Impossible de modifier le créneau permanent : occurrence du jour déjà commencée'
              using errcode = 'P0001';
          end if;

          if shape_changed then
            begin
              update public.calendar_occupations
              set resource_id = target_resource_id,
                  title = 'Créneau permanent · ' || btrim(target_label),
                  starts_at = occurrence_starts_at,
                  ends_at = occurrence_ends_at,
                  cancelled_at = null,
                  updated_at = now(),
                  updated_by = auth.uid()
              where id = existing_occupation_id;
            exception
              when exclusion_violation then
                raise exception 'Impossible de modifier le créneau permanent : conflit le %',
                  to_char(occurrence_date, 'DD/MM/YYYY')
                  using errcode = '23P01';
            end;

            update public.permanent_slot_occurrences
            set status = 'scheduled',
                confirmed_at = null,
                confirmed_by = null,
                released_at = null,
                released_by = null,
                updated_at = now()
            where id = existing_occurrence_id;
          else
            update public.calendar_occupations
            set title = 'Créneau permanent · ' || btrim(target_label),
                updated_at = now(),
                updated_by = auth.uid()
            where id = existing_occupation_id;

            if existing_status = 'cancelled'::public.permanent_slot_occurrence_status then
              begin
                update public.calendar_occupations
                set cancelled_at = null,
                    updated_at = now(),
                    updated_by = auth.uid()
                where id = existing_occupation_id;
              exception
                when exclusion_violation then
                  raise exception 'Impossible de modifier le créneau permanent : conflit le %',
                    to_char(occurrence_date, 'DD/MM/YYYY')
                    using errcode = '23P01';
              end;

              update public.permanent_slot_occurrences
              set status = 'scheduled',
                  confirmed_at = null,
                  confirmed_by = null,
                  released_at = null,
                  released_by = null,
                  updated_at = now()
              where id = existing_occurrence_id;
            end if;
          end if;
        else
          begin
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
          exception
            when exclusion_violation then
              raise exception 'Impossible de modifier le créneau permanent : conflit le %',
                to_char(occurrence_date, 'DD/MM/YYYY')
                using errcode = '23P01';
          end;

          insert into public.permanent_slot_occurrences (
            permanent_slot_id,
            occurrence_date,
            occupation_id
          ) values (
            target_permanent_slot_id,
            occurrence_date,
            created_occupation_id
          );
        end if;
      end if;

      occurrence_date := occurrence_date + 7;
    end loop;

    update public.calendar_occupations as occupation
    set cancelled_at = coalesce(occupation.cancelled_at, now()),
        updated_at = now(),
        updated_by = auth.uid()
    from public.permanent_slot_occurrences as occurrence
    where occurrence.permanent_slot_id = target_permanent_slot_id
      and occurrence.occupation_id = occupation.id
      and occupation.starts_at > now()
      and (
        occurrence.occurrence_date < target_valid_from
        or occurrence.occurrence_date > target_valid_until
        or extract(isodow from occurrence.occurrence_date)::integer <> target_weekday
      );

    update public.permanent_slot_occurrences as occurrence
    set status = 'cancelled',
        confirmed_at = null,
        confirmed_by = null,
        released_at = null,
        released_by = null,
        updated_at = now()
    from public.calendar_occupations as occupation
    where occurrence.permanent_slot_id = target_permanent_slot_id
      and occurrence.occupation_id = occupation.id
      and occupation.starts_at > now()
      and (
        occurrence.occurrence_date < target_valid_from
        or occurrence.occurrence_date > target_valid_until
        or extract(isodow from occurrence.occurrence_date)::integer <> target_weekday
      );
  end if;

  insert into public.permanent_slot_audit_log (
    permanent_slot_id,
    action,
    actor_id
  ) values (
    target_permanent_slot_id,
    'slot_updated',
    auth.uid()
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_my_championship_match_reservation(target_match_id uuid, target_resource_id uuid, target_starts_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  settings public.club_reservation_settings%rowtype;
  target_ends_at timestamptz;
  target_club_id uuid;
  target_team_id uuid;
  target_championship_id uuid;
  target_status public.championship_status;
  match_payment_mode text;
  terms record;
  created_reservation public.reservations;
  match_label text;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select scoped_settings.*
  into strict settings
  from public.reservable_resources as resource
  join public.club_reservation_settings as scoped_settings
    on scoped_settings.club_id = resource.club_id
  where resource.id = target_resource_id
    and resource.is_active;
  target_ends_at := target_starts_at
    + make_interval(mins => settings.default_duration_minutes);

  select resource.club_id into target_club_id
  from public.reservable_resources as resource
  where resource.id = target_resource_id and resource.is_active;

  if target_club_id is null then
    raise exception 'La ressource demandée est indisponible' using errcode = 'P0001';
  end if;

  select
    case
      when exists (
        select 1 from public.championship_team_players tp
        join public.championship_players p on p.id = tp.player_id
        where p.profile_id = actor_id and p.link_status in ('claimed', 'verified')
          and tp.team_id = match.team1_id
      ) then match.team1_id
      when exists (
        select 1 from public.championship_team_players tp
        join public.championship_players p on p.id = tp.player_id
        where p.profile_id = actor_id and p.link_status in ('claimed', 'verified')
          and tp.team_id = match.team2_id
      ) then match.team2_id
      else null
    end,
    championship.id,
    championship.status,
    coalesce(policy.match_payment_mode, 'free'),
    concat_ws(' · ', championship.name, division.name,
      concat(team1.source_label, ' – ', team2.source_label))
  into target_team_id, target_championship_id, target_status,
       match_payment_mode, match_label
  from public.championship_matches as match
  join public.championship_divisions as division on division.id = match.division_id
  join public.championships as championship on championship.id = division.championship_id
  join public.championship_teams team1 on team1.id = match.team1_id
  join public.championship_teams team2 on team2.id = match.team2_id
  left join public.championship_reservation_settings policy
    on policy.club_id = target_club_id
  where match.id = target_match_id;

  if target_team_id is null or target_status not in ('preparation', 'active') then
    raise exception 'Cette rencontre ne peut pas être réservée depuis ce compte'
      using errcode = '42501';
  end if;

  if not public.championship_reservation_player_is_eligible(target_club_id, actor_id) then
    raise exception 'Vous ne bénéficiez pas de l’accès réservation championnat'
      using errcode = '42501';
  end if;

  if exists (
    select 1 from public.reservations r
    where r.championship_match_id = target_match_id
      and r.status in ('pending', 'confirmed')
  ) then
    raise exception 'Cette rencontre possède déjà une réservation active'
      using errcode = '23505';
  end if;

  if match_payment_mode = 'standard' and settings.online_payment_enabled then
    raise exception 'CHAMPIONSHIP_PAYMENT_REQUIRED' using errcode = 'P0001';
  end if;

  select * into strict terms
  from public.assert_reservation_slot_allowed(
    target_resource_id, actor_id, target_starts_at, target_ends_at, null
  );

  if match_payment_mode = 'standard' then
    created_reservation := public.create_reservation_record(
      target_resource_id, target_starts_at, null, null, null
    );
  else
    insert into public.reservations (
      resource_id, user_id, customer_type, status, starts_at, ends_at,
      price_cents, payment_required, championship_match_id, created_by, updated_by
    ) values (
      target_resource_id, actor_id, terms.customer_type, 'confirmed',
      target_starts_at, target_ends_at, 0, false, target_match_id,
      actor_id, actor_id
    ) returning * into created_reservation;

    insert into public.calendar_occupations (
      resource_id, occupation_type, reservation_id, title,
      starts_at, ends_at, created_by, updated_by
    ) values (
      target_resource_id, 'reservation', created_reservation.id, match_label,
      target_starts_at, target_ends_at, actor_id, actor_id
    );
  end if;

  if match_payment_mode = 'standard' then
    update public.reservations
    set championship_match_id = target_match_id,
        updated_at = now(), updated_by = actor_id
    where id = created_reservation.id;

    update public.calendar_occupations
    set title = match_label, updated_at = now(), updated_by = actor_id
    where reservation_id = created_reservation.id and cancelled_at is null;
  end if;

  insert into public.reservation_audit_log (
    reservation_id, action, actor_id, new_data
  ) values (
    created_reservation.id, 'championship_match_created', actor_id,
    jsonb_build_object(
      'championship_match_id', target_match_id,
      'match_payment_mode', match_payment_mode,
      'payment_required', false,
      'price_cents', case when match_payment_mode = 'free' then 0 else created_reservation.price_cents end
    )
  );

  return jsonb_build_object(
    'reservation_id', created_reservation.id,
    'championship_match_id', target_match_id,
    'starts_at', target_starts_at,
    'ends_at', target_ends_at,
    'price_cents', case when match_payment_mode = 'free' then 0 else created_reservation.price_cents end,
    'payment_required', false
  );
exception
  when exclusion_violation then
    raise exception 'Ce créneau vient d''être réservé par une autre personne'
      using errcode = '23P01';
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_championship_reservation_context(target_match_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  result jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'match_id', match.id,
    'championship_id', championship.id,
    'championship_name', championship.name,
    'championship_status', championship.status,
    'division_id', division.id,
    'division_name', division.name,
    'display_color', division.display_color,
    'team1_label', team1.source_label,
    'team2_label', team2.source_label,
    'match_payment_mode', coalesce(reservation_policy.match_payment_mode, 'free'),
    'online_payment_enabled', coalesce(global_settings.online_payment_enabled, false),
    'existing_reservation', case
      when reservation.id is null then null
      else jsonb_build_object(
        'id', reservation.id,
        'resource_id', reservation.resource_id,
        'starts_at', reservation.starts_at,
        'ends_at', reservation.ends_at,
        'status', reservation.status
      )
    end
  )
  into result
  from public.championship_matches as match
  join public.championship_divisions as division on division.id = match.division_id
  join public.championships as championship on championship.id = division.championship_id
  join public.championship_teams as team1 on team1.id = match.team1_id
  join public.championship_teams as team2 on team2.id = match.team2_id
  join public.championship_federation_clubs as my_federation_club
    on my_federation_club.id = case
      when exists (
        select 1 from public.championship_team_players as tp
        join public.championship_players as p on p.id = tp.player_id
        where p.profile_id = actor_id
          and p.link_status in ('claimed', 'verified')
          and tp.team_id = match.team1_id
      ) then team1.federation_club_id
      else team2.federation_club_id
    end
  left join public.championship_club_links as club_link
    on club_link.championship_id = championship.id
   and club_link.federation_club_id = my_federation_club.id
  left join public.championship_reservation_settings as reservation_policy
    on reservation_policy.club_id = club_link.club_id
  left join public.club_reservation_settings as global_settings
    on global_settings.club_id = club_link.club_id
  left join lateral (
    select r.*
    from public.reservations as r
    where r.championship_match_id = match.id
      and r.status in ('pending', 'confirmed')
    order by r.created_at desc
    limit 1
  ) as reservation on true
  where match.id = target_match_id
    and championship.status in ('preparation', 'active')
    and exists (
      select 1
      from public.championship_team_players as team_player
      join public.championship_players as player on player.id = team_player.player_id
      where player.profile_id = actor_id
        and player.link_status in ('claimed', 'verified')
        and (
          team_player.team_id = match.team1_id
          or (
            team_player.team_id = match.team2_id
            and exists (
              select 1
              from public.championship_teams as away_team
              join public.championship_federation_clubs as away_club on away_club.id = away_team.federation_club_id
              join public.championship_match_club_venue_overrides as venue_override
                on venue_override.match_id = match.id
               and venue_override.club_id = away_club.linked_club_id
               and venue_override.enabled
              where away_team.id = match.team2_id
            )
          )
        )
    );

  if result is null then
    raise exception 'Championship match is not reservable by this user'
      using errcode = '42501';
  end if;

  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_public_tv_display(target_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  settings public.club_tv_settings;
  club_record public.clubs;
  display_day date := (now() at time zone 'Europe/Paris')::date;
  week_start date := display_day;
  week_end date := display_day + 6;
begin
  select tv_settings.*
  into settings
  from public.club_tv_settings as tv_settings
  where tv_settings.public_token = target_token;

  if settings.club_id is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  select clubs.*
  into club_record
  from public.clubs as clubs
  where clubs.id = settings.club_id;

  if not settings.is_enabled then
    return jsonb_build_object(
      'status', 'disabled',
      'club_name', club_record.name,
      'club_logo_url', club_record.logo_url,
      'generated_at', now()
    );
  end if;

  return (
    with selected_resources as (
      select
        resources.id,
        resources.name,
        resources.timezone,
        selected.display_order
      from public.club_tv_resources as selected
      join public.reservable_resources as resources
        on resources.id = selected.resource_id
       and resources.club_id = selected.club_id
      where selected.club_id = settings.club_id
        and resources.is_active
    ),
    opening_periods as (
      select
        resources.id as resource_id,
        resources.name as resource_name,
        resources.timezone,
        resources.display_order,
        opening_hours.opens_at,
        opening_hours.closes_at,
        reservation_settings.default_duration_minutes,
        reservation_settings.booking_step_minutes
      from selected_resources as resources
      join public.resource_opening_hours as opening_hours
        on opening_hours.resource_id = resources.id
       and opening_hours.weekday = extract(dow from display_day)::smallint
       and opening_hours.is_open
      join public.club_reservation_settings as reservation_settings
        on reservation_settings.club_id = settings.club_id
    ),
    generated_slots as (
      select
        periods.resource_id,
        periods.resource_name,
        periods.display_order,
        slot_local at time zone periods.timezone as starts_at,
        (
          slot_local
          + make_interval(mins => periods.default_duration_minutes)
        ) at time zone periods.timezone as ends_at
      from opening_periods as periods
      cross join lateral generate_series(
        greatest(
          display_day + periods.opens_at,
          display_day + settings.display_start_time
        ),
        least(
          display_day + periods.closes_at,
          display_day + settings.display_end_time
        ) - make_interval(mins => periods.default_duration_minutes),
        make_interval(mins => periods.booking_step_minutes)
      ) as slot_local
    ),
    projected_slots as (
      select
        slots.resource_id,
        slots.starts_at,
        slots.ends_at,
        case
          when occupation.id is null then 'available'
          when occupation.occupation_type = 'reservation'::public.occupation_type then 'reserved'
          else 'unavailable'
        end as status,
        case
          when occupation.id is null then null
          when occupation.occupation_type = 'reservation'::public.occupation_type then
            coalesce(
              nullif(btrim(concat_ws(' ', member.first_name, member.last_name)), ''),
              nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
              nullif(btrim(profile.display_name), ''),
              nullif(btrim(reservation.guest_name), ''),
              'Réservation'
            )
          else coalesce(nullif(btrim(occupation.title), ''), 'Indisponible')
        end as display_name
      from generated_slots as slots
      left join lateral (
        select current_occupation.*
        from public.calendar_occupations as current_occupation
        where current_occupation.resource_id = slots.resource_id
          and current_occupation.cancelled_at is null
          and current_occupation.starts_at < slots.ends_at
          and current_occupation.ends_at > slots.starts_at
        order by current_occupation.starts_at
        limit 1
      ) as occupation on true
      left join public.reservations as reservation
        on reservation.id = occupation.reservation_id
      left join public.profiles as profile
        on profile.id = reservation.user_id
      left join public.club_members as member
        on member.id = public.profile_club_member_id(profile.id, settings.club_id)
      where slots.ends_at > now()
    ),
    ranked_slots as (
      select
        slots.*,
        row_number() over (
          partition by slots.resource_id
          order by slots.starts_at
        ) as slot_rank
      from projected_slots as slots
    ),
    resources_payload as (
      select
        resources.id,
        resources.name,
        resources.display_order,
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'starts_at', slots.starts_at,
              'ends_at', slots.ends_at,
              'status', slots.status,
              'display_name', slots.display_name
            )
            order by slots.starts_at
          ) filter (
            where slots.slot_rank <= settings.visible_slot_count
          ),
          '[]'::jsonb
        ) as slots
      from selected_resources as resources
      left join ranked_slots as slots
        on slots.resource_id = resources.id
       and slots.slot_rank <= settings.visible_slot_count
      group by resources.id, resources.name, resources.display_order
    ),
    week_dates as (
      select generate_series(
        week_start::timestamp,
        week_end::timestamp,
        interval '1 day'
      )::date as display_date
    ),
    week_items as (
      select
        dates.display_date,
        resources.id as resource_id,
        resources.name as resource_name,
        resources.display_order,
        occupation.display_starts_at as starts_at,
        occupation.display_ends_at as ends_at,
        case
          when occupation.occupation_type = 'reservation'::public.occupation_type then 'reserved'
          else 'unavailable'
        end as status,
        case
          when occupation.occupation_type = 'reservation'::public.occupation_type then
            coalesce(
              nullif(btrim(concat_ws(' ', member.first_name, member.last_name)), ''),
              nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
              nullif(btrim(profile.display_name), ''),
              nullif(btrim(reservation.guest_name), ''),
              'Réservation'
            )
          else coalesce(nullif(btrim(occupation.title), ''), 'Indisponible')
        end as display_name
      from selected_resources as resources
      cross join week_dates as dates
      join lateral (
        select
          current_occupation.*,
          greatest(
            current_occupation.starts_at,
            (dates.display_date + settings.display_start_time)
              at time zone resources.timezone
          ) as display_starts_at,
          least(
            current_occupation.ends_at,
            (dates.display_date + settings.display_end_time)
              at time zone resources.timezone
          ) as display_ends_at
        from public.calendar_occupations as current_occupation
        where current_occupation.resource_id = resources.id
          and current_occupation.cancelled_at is null
          and current_occupation.starts_at
            < (dates.display_date + settings.display_end_time)
                at time zone resources.timezone
          and current_occupation.ends_at
            > (dates.display_date + settings.display_start_time)
                at time zone resources.timezone
        order by current_occupation.starts_at
      ) as occupation on true
      left join public.reservations as reservation
        on reservation.id = occupation.reservation_id
      left join public.profiles as profile
        on profile.id = reservation.user_id
      left join public.club_members as member
        on member.id = public.profile_club_member_id(profile.id, settings.club_id)
    ),
    week_payload as (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'date', dates.display_date,
            'items', coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'resource_id', items.resource_id,
                    'resource_name', items.resource_name,
                    'starts_at', items.starts_at,
                    'ends_at', items.ends_at,
                    'status', items.status,
                    'display_name', items.display_name
                  )
                  order by
                    items.starts_at,
                    items.display_order,
                    items.resource_name
                )
                from week_items as items
                where items.display_date = dates.display_date
              ),
              '[]'::jsonb
            )
          )
          order by dates.display_date
        ),
        '[]'::jsonb
      ) as days
      from week_dates as dates
    )
    select jsonb_build_object(
      'status', 'ready',
      'club_name', club_record.name,
      'club_logo_url', club_record.logo_url,
      'display_date', display_day,
      'display_start_time', to_char(settings.display_start_time, 'HH24:MI'),
      'display_end_time', to_char(settings.display_end_time, 'HH24:MI'),
      'refresh_interval_seconds', settings.refresh_interval_seconds,
      'generated_at', now(),
      'resources', (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'id', resources.id,
              'name', resources.name,
              'slots', resources.slots
            )
            order by resources.display_order
          ),
          '[]'::jsonb
        )
        from resources_payload as resources
      ),
      'week_start', week_start,
      'week_end', week_end,
      'week_days', (select days from week_payload)
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.simulate_payment(target_payment_id uuid, simulated_outcome text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  payment_row public.payments;
  final_status public.payment_status;
  licence_request_row public.licence_requests%rowtype;
  payment_mode_value text;
begin
  if simulated_outcome not in ('paid', 'failed', 'cancelled') then
    raise exception 'Résultat de simulation invalide' using errcode = '22023';
  end if;

  select payment.*
  into payment_row
  from public.payments as payment
  where payment.id = target_payment_id
    and payment.status = 'pending'
    and payment.provider_checkout_intent_id is null
    and (
      (
        payment.payment_context = 'reservation'
        and exists (
          select 1
          from public.reservations as reservation
          where reservation.id = payment.reservation_id
            and (
              payment.payer_profile_id = actor_id
              or (
                payment.payer_profile_id is null
                and (
                  reservation.user_id = actor_id
                  or reservation.user_id is null
                )
              )
            )
        )
      )
      or
      (
        payment.payment_context = 'licence'
        and exists (
          select 1
          from public.licence_requests as request
          where request.id = payment.licence_request_id
            and request.profile_id = actor_id
            and request.status not in ('approved', 'licensed', 'cancelled')
        )
      )
    )
  for update of payment;

  if payment_row.id is null then
    raise exception 'Paiement simulable introuvable' using errcode = 'P0002';
  end if;

  if payment_row.payment_context = 'reservation' then
    select settings.payment_mode
    into payment_mode_value
    from public.reservations as reservation
    join public.reservable_resources as resource
      on resource.id = reservation.resource_id
    join public.club_reservation_settings as settings
      on settings.club_id = resource.club_id
    where reservation.id = payment_row.reservation_id;
  elsif payment_row.payment_context = 'licence' then
    select campaign.payment_mode
    into payment_mode_value
    from public.licence_requests as request
    join public.licence_campaigns as campaign
      on campaign.id = request.campaign_id
    where request.id = payment_row.licence_request_id;
  end if;

  if coalesce(payment_mode_value, 'helloasso') <> 'test' then
    raise exception 'Le paiement simulé est désactivé' using errcode = '42501';
  end if;

  final_status := simulated_outcome::public.payment_status;

  update public.payments
  set status = final_status,
      paid_at = case when final_status = 'paid' then now() else paid_at end,
      failure_reason = case
        when final_status = 'failed' then 'Paiement refusé en mode test'
        when final_status = 'cancelled' then 'Paiement annulé en mode test'
        else null
      end,
      metadata = metadata || jsonb_build_object(
        'simulated', true,
        'outcome', simulated_outcome
      ),
      updated_at = now()
  where id = payment_row.id
  returning * into payment_row;

  if payment_row.payment_context = 'licence' then
    select request.*
    into licence_request_row
    from public.licence_requests as request
    where request.id = payment_row.licence_request_id
    for update;

    if licence_request_row.id is not null
      and licence_request_row.status not in ('approved', 'licensed', 'cancelled')
    then
      update public.licence_requests
      set status = case
          when final_status = 'paid'
            and licence_request_row.document_path is not null
            then 'ready_for_review'::public.licence_request_status
          when final_status = 'paid'
            then 'pending_documents'::public.licence_request_status
          when licence_request_row.document_path is not null
            then 'pending_payment'::public.licence_request_status
          else 'pending_documents'::public.licence_request_status
        end,
        updated_at = now()
      where id = licence_request_row.id;
    end if;

    return simulated_outcome;
  end if;

  if final_status = 'paid' then
    update public.club_communications as communication
    set status = 'archived',
        archived_at = coalesce(communication.archived_at, now()),
        updated_at = now()
    where communication.id = (
      select event.communication_id
      from public.reservation_payment_notification_events as event
      where event.payment_id = payment_row.id
    )
      and communication.status = 'published';
  end if;

  perform public.reconcile_reservation_payment_state(payment_row.reservation_id);

  insert into public.reservation_audit_log (
    reservation_id,
    action,
    actor_id,
    new_data
  ) values (
    payment_row.reservation_id,
    'payment_simulated:' || simulated_outcome,
    actor_id,
    jsonb_build_object(
      'payment_id', payment_row.id,
      'payer_profile_id', payment_row.payer_profile_id
    )
  );

  return simulated_outcome;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_reservation_terms(target_user_id uuid, target_starts_at timestamptz)
RETURNS TABLE(customer_type public.reservation_customer_type, advance_hours integer, price_cents integer, max_active_reservations integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
declare
  target_club_id uuid;
  settings public.club_reservation_settings%rowtype;
  active_licensee boolean;
begin
  select min(club_id) into target_club_id
  from public.club_reservation_settings
  having count(*) = 1;
  if target_club_id is null then
    raise exception 'Resource selection required' using errcode = '22023';
  end if;
  select * into strict settings from public.club_reservation_settings where club_id = target_club_id;
  active_licensee := target_user_id is not null
    and public.is_active_licensee_for_club(target_user_id,target_club_id,(target_starts_at at time zone 'Europe/Paris')::date);
  if active_licensee then
    return query select 'licensee'::public.reservation_customer_type,settings.licensee_advance_hours,settings.licensee_price_cents,settings.licensee_max_active_reservations;
  elsif target_user_id is not null then
    return query select 'account'::public.reservation_customer_type,settings.public_advance_hours,settings.public_price_cents,settings.public_max_active_reservations;
  else
    return query select 'guest'::public.reservation_customer_type,settings.public_advance_hours,settings.public_price_cents,settings.public_max_active_reservations;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_payment_mode()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
declare result text;
begin
  select min(payment_mode) into result from public.club_reservation_settings having count(*) = 1;
  if result is null then raise exception 'Resource selection required' using errcode = '22023'; end if;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_online_payment_enabled()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
declare result boolean;
begin
  select bool_or(online_payment_enabled) into result from public.club_reservation_settings having count(*) = 1;
  if result is null then raise exception 'Resource selection required' using errcode = '22023'; end if;
  return result;
end;
$function$;

commit;
