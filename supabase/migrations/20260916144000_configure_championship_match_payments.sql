begin;

alter table public.championship_reservation_settings
  add column if not exists match_payment_mode text not null default 'free';

alter table public.championship_reservation_settings
  drop constraint if exists championship_reservation_settings_match_payment_mode_check;
alter table public.championship_reservation_settings
  add constraint championship_reservation_settings_match_payment_mode_check
  check (match_payment_mode in ('free', 'standard'));

create or replace function public.admin_get_championship_reservation_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  setting public.championship_reservation_settings%rowtype;
begin
  if not public.has_club_permission(target_club_id, 'championships.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select * into setting
  from public.championship_reservation_settings
  where club_id = target_club_id;

  return jsonb_build_object(
    'clubId', target_club_id,
    'enabled', coalesce(setting.enabled, false),
    'advanceDays', coalesce(setting.advance_days, 90),
    'maxActiveReservations', coalesce(setting.max_active_reservations, 20),
    'matchPaymentMode', coalesce(setting.match_payment_mode, 'free'),
    'eligiblePlayerCount', (
      select count(distinct player.profile_id)
      from public.championship_players as player
      join public.championship_team_players as team_player
        on team_player.player_id = player.id
      join public.championship_teams as team
        on team.id = team_player.team_id
      join public.championship_federation_clubs as federation_club
        on federation_club.id = team.federation_club_id
      join public.championship_divisions as division
        on division.id = team.division_id
      join public.championships as championship
        on championship.id = division.championship_id
      join public.championship_club_links as club_link
        on club_link.championship_id = championship.id
       and club_link.federation_club_id = federation_club.id
       and club_link.club_id = target_club_id
      where player.profile_id is not null
        and player.link_status in ('claimed', 'verified')
        and federation_club.linked_club_id = target_club_id
        and championship.status in ('preparation', 'active')
    ),
    'resources', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', resource.id,
          'name', resource.name,
          'selected', selected_resource.resource_id is not null
        ) order by resource.name
      )
      from public.reservable_resources as resource
      left join public.championship_reservation_resources as selected_resource
        on selected_resource.club_id = target_club_id
       and selected_resource.resource_id = resource.id
      where resource.club_id = target_club_id
        and resource.is_active
    ), '[]'::jsonb),
    'windows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'weekday', priority_window.weekday,
          'opensAt', to_char(priority_window.opens_at, 'HH24:MI'),
          'closesAt', to_char(priority_window.closes_at, 'HH24:MI')
        ) order by priority_window.weekday
      )
      from public.championship_reservation_windows as priority_window
      where priority_window.club_id = target_club_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_save_championship_reservation_settings_v2(
  target_enabled boolean,
  target_advance_days integer,
  target_max_active_reservations integer,
  target_match_payment_mode text,
  target_resource_ids uuid[],
  target_windows jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  resource_count integer;
  requested_resource_count integer;
  window_value jsonb;
  weekday_value integer;
  opens_value time;
  closes_value time;
begin
  if not public.has_club_permission(target_club_id, 'championships.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if target_advance_days not between 1 and 365
    or target_max_active_reservations not between 1 and 100
    or target_match_payment_mode not in ('free', 'standard') then
    raise exception 'Paramètres de réservation championnat invalides'
      using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(target_windows, '[]'::jsonb)) <> 'array' then
    raise exception 'Les plages horaires sont invalides'
      using errcode = '22023';
  end if;

  select count(distinct resource_id)
  into requested_resource_count
  from unnest(coalesce(target_resource_ids, '{}'::uuid[])) as resource_id;

  select count(*)
  into resource_count
  from public.reservable_resources as resource
  where resource.id = any(coalesce(target_resource_ids, '{}'::uuid[]))
    and resource.club_id = target_club_id
    and resource.is_active;

  if resource_count <> requested_resource_count then
    raise exception 'Un terrain sélectionné est invalide'
      using errcode = '22023';
  end if;

  if target_enabled
    and (requested_resource_count = 0
      or jsonb_array_length(coalesce(target_windows, '[]'::jsonb)) = 0) then
    raise exception 'Sélectionnez au moins un terrain et une plage horaire'
      using errcode = '22023';
  end if;

  insert into public.championship_reservation_settings (
    club_id, enabled, advance_days, max_active_reservations,
    match_payment_mode, created_by, updated_by
  ) values (
    target_club_id, target_enabled, target_advance_days,
    target_max_active_reservations, target_match_payment_mode,
    auth.uid(), auth.uid()
  )
  on conflict (club_id) do update set
    enabled = excluded.enabled,
    advance_days = excluded.advance_days,
    max_active_reservations = excluded.max_active_reservations,
    match_payment_mode = excluded.match_payment_mode,
    updated_at = now(),
    updated_by = auth.uid();

  delete from public.championship_reservation_resources
  where club_id = target_club_id;

  insert into public.championship_reservation_resources (club_id, resource_id)
  select target_club_id, resource_id
  from (
    select distinct resource_id
    from unnest(coalesce(target_resource_ids, '{}'::uuid[])) as resource_id
  ) as selected;

  delete from public.championship_reservation_windows
  where club_id = target_club_id;

  for window_value in
    select value from jsonb_array_elements(coalesce(target_windows, '[]'::jsonb))
  loop
    weekday_value := nullif(window_value ->> 'weekday', '')::integer;
    opens_value := nullif(window_value ->> 'opensAt', '')::time;
    closes_value := nullif(window_value ->> 'closesAt', '')::time;

    if weekday_value not between 1 and 7
      or opens_value is null
      or closes_value is null
      or closes_value <= opens_value then
      raise exception 'Une plage horaire championnat est invalide'
        using errcode = '22023';
    end if;

    insert into public.championship_reservation_windows (
      club_id, weekday, opens_at, closes_at
    ) values (
      target_club_id, weekday_value, opens_value, closes_value
    );
  end loop;
end;
$$;

revoke all on function public.admin_save_championship_reservation_settings_v2(
  boolean, integer, integer, text, uuid[], jsonb
) from public, anon, authenticated;
grant execute on function public.admin_save_championship_reservation_settings_v2(
  boolean, integer, integer, text, uuid[], jsonb
) to authenticated;

create or replace function public.get_my_championship_reservation_context(
  target_match_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
  cross join public.reservation_settings as global_settings
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
        and team_player.team_id in (match.team1_id, match.team2_id)
    );

  if result is null then
    raise exception 'Championship match is not reservable by this user'
      using errcode = '42501';
  end if;

  return result;
end;
$$;

create or replace function public.create_my_championship_match_reservation(
  target_match_id uuid,
  target_resource_id uuid,
  target_starts_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  settings public.reservation_settings%rowtype;
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

  select * into strict settings from public.reservation_settings where id;
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
$$;

create or replace function public.reserve_my_championship_match_for_payment(
  target_match_id uuid,
  target_resource_id uuid,
  target_starts_at timestamptz
)
returns table (
  reservation_id uuid,
  payment_id uuid,
  amount_cents integer,
  currency text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  context jsonb;
  created_reservation public.reservations;
  created_payment public.payments;
  label text;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  context := public.get_my_championship_reservation_context(target_match_id);
  if coalesce(context ->> 'match_payment_mode', 'free') <> 'standard' then
    raise exception 'Cette rencontre est configurée sans paiement' using errcode = 'P0001';
  end if;
  if not coalesce((context ->> 'online_payment_enabled')::boolean, false) then
    raise exception 'Le paiement en ligne est désactivé' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.reservations r
    where r.championship_match_id = target_match_id
      and r.status in ('pending', 'confirmed')
  ) then
    raise exception 'Cette rencontre possède déjà une réservation active'
      using errcode = '23505';
  end if;

  created_reservation := public.create_reservation_record(
    target_resource_id, target_starts_at, null, null, null
  );

  label := concat_ws(' · ',
    context ->> 'championship_name',
    context ->> 'division_name',
    concat(context ->> 'team1_label', ' – ', context ->> 'team2_label')
  );

  update public.reservations
  set championship_match_id = target_match_id,
      status = 'pending',
      payment_required = true,
      payment_status = 'pending',
      payment_plan = 'full',
      updated_at = now(),
      updated_by = actor_id
  where id = created_reservation.id
  returning * into created_reservation;

  update public.calendar_occupations
  set title = label, updated_at = now(), updated_by = actor_id
  where reservation_id = created_reservation.id and cancelled_at is null;

  insert into public.payments (
    reservation_id, payer_profile_id, amount_cents, currency, metadata
  ) values (
    created_reservation.id, actor_id, created_reservation.price_cents,
    created_reservation.currency,
    jsonb_build_object(
      'reservation_id', created_reservation.id,
      'payment_plan', 'full',
      'championship_match_id', target_match_id
    )
  ) returning * into created_payment;

  insert into public.reservation_audit_log (
    reservation_id, action, actor_id, new_data
  ) values (
    created_reservation.id, 'championship_payment_started', actor_id,
    jsonb_build_object('payment_id', created_payment.id,
      'championship_match_id', target_match_id)
  );

  return query select created_reservation.id, created_payment.id,
    created_payment.amount_cents, created_payment.currency,
    created_payment.expires_at;
end;
$$;

revoke all on function public.reserve_my_championship_match_for_payment(uuid, uuid, timestamptz)
from public, anon, authenticated;
grant execute on function public.reserve_my_championship_match_for_payment(uuid, uuid, timestamptz)
to authenticated;

commit;
