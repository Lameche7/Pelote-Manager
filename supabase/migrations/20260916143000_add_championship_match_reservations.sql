begin;

alter table public.championship_divisions
  add column if not exists display_color text;

alter table public.championship_divisions
  drop constraint if exists championship_divisions_display_color_check;
alter table public.championship_divisions
  add constraint championship_divisions_display_color_check
  check (display_color is null or display_color ~ '^#[0-9A-Fa-f]{6}$');

alter table public.reservations
  add column if not exists championship_match_id uuid
  references public.championship_matches(id) on delete set null;

create unique index if not exists reservations_one_active_championship_match_idx
on public.reservations (championship_match_id)
where championship_match_id is not null
  and status in ('pending', 'confirmed');

create index if not exists reservations_championship_match_idx
on public.reservations (championship_match_id)
where championship_match_id is not null;

create or replace function public.admin_get_championship_division_colors(
  target_id uuid
)
returns table (
  division_id uuid,
  division_name text,
  display_color text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
begin
  if not public.championship_club_can_manage(target_id, target_club_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  return query
  select division.id, division.name, division.display_color
  from public.championship_divisions as division
  where division.championship_id = target_id
  order by division.display_order, division.name;
end;
$$;

revoke all on function public.admin_get_championship_division_colors(uuid)
from public, anon, authenticated;
grant execute on function public.admin_get_championship_division_colors(uuid)
to authenticated;

create or replace function public.admin_update_championship_division_color(
  target_division_id uuid,
  target_color text
)
returns table (
  division_id uuid,
  division_name text,
  display_color text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_championship_id uuid;
  target_status public.championship_status;
  normalized_color text := upper(nullif(btrim(target_color), ''));
begin
  select division.championship_id, championship.status
  into target_championship_id, target_status
  from public.championship_divisions as division
  join public.championships as championship
    on championship.id = division.championship_id
  where division.id = target_division_id;

  if target_championship_id is null
    or not public.championship_club_can_manage(target_championship_id, target_club_id)
  then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if target_status = 'archived'::public.championship_status then
    raise exception 'Archived championship is read-only' using errcode = '22023';
  end if;

  if normalized_color is not null
    and normalized_color !~ '^#[0-9A-F]{6}$'
  then
    raise exception 'Invalid championship division color' using errcode = '22023';
  end if;

  update public.championship_divisions as division
  set display_color = normalized_color,
      updated_at = now()
  where division.id = target_division_id;

  return query
  select division.id, division.name, division.display_color
  from public.championship_divisions as division
  where division.id = target_division_id;
end;
$$;

revoke all on function public.admin_update_championship_division_color(uuid, text)
from public, anon, authenticated;
grant execute on function public.admin_update_championship_division_color(uuid, text)
to authenticated;

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
  join public.championship_divisions as division
    on division.id = match.division_id
  join public.championships as championship
    on championship.id = division.championship_id
  join public.championship_teams as team1 on team1.id = match.team1_id
  join public.championship_teams as team2 on team2.id = match.team2_id
  left join lateral (
    select reservation.*
    from public.reservations as reservation
    where reservation.championship_match_id = match.id
      and reservation.status in ('pending', 'confirmed')
    order by reservation.created_at desc
    limit 1
  ) as reservation on true
  where match.id = target_match_id
    and championship.status in ('preparation', 'active')
    and exists (
      select 1
      from public.championship_team_players as team_player
      join public.championship_players as player
        on player.id = team_player.player_id
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

revoke all on function public.get_my_championship_reservation_context(uuid)
from public, anon, authenticated;
grant execute on function public.get_my_championship_reservation_context(uuid)
to authenticated;

create or replace function public.get_my_championship_match_reservations()
returns table (
  match_id uuid,
  reservation_id uuid,
  resource_id uuid,
  resource_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    reservation.championship_match_id,
    reservation.id,
    reservation.resource_id,
    resource.name,
    reservation.starts_at,
    reservation.ends_at,
    reservation.status::text
  from public.reservations as reservation
  join public.reservable_resources as resource
    on resource.id = reservation.resource_id
  join public.championship_matches as match
    on match.id = reservation.championship_match_id
  where reservation.user_id = auth.uid()
    and reservation.championship_match_id is not null
    and reservation.status in ('pending', 'confirmed')
    and exists (
      select 1
      from public.championship_team_players as team_player
      join public.championship_players as player
        on player.id = team_player.player_id
      where player.profile_id = auth.uid()
        and player.link_status in ('claimed', 'verified')
        and team_player.team_id in (match.team1_id, match.team2_id)
    )
  order by reservation.starts_at;
$$;

revoke all on function public.get_my_championship_match_reservations()
from public, anon, authenticated;
grant execute on function public.get_my_championship_match_reservations()
to authenticated;

create or replace function public.link_my_championship_match_reservation(
  target_match_id uuid,
  target_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_club_id uuid;
  target_team_id uuid;
  target_championship_id uuid;
  target_status public.championship_status;
  reservation_record public.reservations;
  label text;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select reservation.*
  into reservation_record
  from public.reservations as reservation
  where reservation.id = target_reservation_id
    and reservation.user_id = actor_id
    and reservation.status in ('pending', 'confirmed')
  for update;

  if reservation_record.id is null then
    raise exception 'Reservation not found' using errcode = 'P0002';
  end if;

  select
    resource.club_id,
    case
      when exists (
        select 1
        from public.championship_team_players as team_player
        join public.championship_players as player
          on player.id = team_player.player_id
        where player.profile_id = actor_id
          and player.link_status in ('claimed', 'verified')
          and team_player.team_id = match.team1_id
      ) then match.team1_id
      when exists (
        select 1
        from public.championship_team_players as team_player
        join public.championship_players as player
          on player.id = team_player.player_id
        where player.profile_id = actor_id
          and player.link_status in ('claimed', 'verified')
          and team_player.team_id = match.team2_id
      ) then match.team2_id
      else null
    end,
    championship.id,
    championship.status,
    concat_ws(' · ',
      championship.name,
      division.name,
      concat(team1.source_label, ' – ', team2.source_label)
    )
  into target_club_id, target_team_id, target_championship_id, target_status, label
  from public.championship_matches as match
  join public.championship_divisions as division on division.id = match.division_id
  join public.championships as championship on championship.id = division.championship_id
  join public.championship_teams as team1 on team1.id = match.team1_id
  join public.championship_teams as team2 on team2.id = match.team2_id
  join public.reservable_resources as resource on resource.id = reservation_record.resource_id
  where match.id = target_match_id;

  if target_team_id is null
    or target_championship_id is null
    or target_status not in ('preparation', 'active')
  then
    raise exception 'Championship match is not reservable by this user'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.championship_teams as team
    join public.championship_federation_clubs as federation_club
      on federation_club.id = team.federation_club_id
    join public.championship_club_links as club_link
      on club_link.championship_id = target_championship_id
     and club_link.federation_club_id = federation_club.id
     and club_link.club_id = target_club_id
    where team.id = target_team_id
      and federation_club.linked_club_id = target_club_id
  ) then
    raise exception 'Championship match is not linked to this club'
      using errcode = '42501';
  end if;

  update public.reservations
  set championship_match_id = target_match_id,
      updated_at = now(),
      updated_by = actor_id
  where id = target_reservation_id;

  update public.calendar_occupations
  set title = label,
      updated_at = now(),
      updated_by = actor_id
  where reservation_id = target_reservation_id
    and cancelled_at is null;

  insert into public.reservation_audit_log (
    reservation_id,
    action,
    actor_id,
    new_data
  ) values (
    target_reservation_id,
    'championship_match_linked',
    actor_id,
    jsonb_build_object('championship_match_id', target_match_id)
  );

  return jsonb_build_object(
    'reservation_id', target_reservation_id,
    'championship_match_id', target_match_id
  );
exception
  when unique_violation then
    raise exception 'Cette rencontre possède déjà une réservation active'
      using errcode = '23505';
end;
$$;

revoke all on function public.link_my_championship_match_reservation(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.link_my_championship_match_reservation(uuid, uuid)
to authenticated;

create or replace function public.list_available_slots_v3(
  target_resource_id uuid,
  range_start date,
  range_end date
)
returns table (
  resource_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  booking_opens_at timestamptz,
  booked_by_name text,
  occupation_type text,
  display_color text,
  reservation_access text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    slot.resource_id,
    slot.starts_at,
    slot.ends_at,
    slot.status,
    slot.booking_opens_at,
    coalesce(championship_slot.display_name, slot.booked_by_name),
    case
      when championship_slot.match_id is not null then 'championship_match'
      else slot.occupation_type
    end,
    coalesce(championship_slot.display_color, slot.display_color),
    slot.reservation_access
  from public.list_available_slots_v2(
    target_resource_id,
    range_start,
    range_end
  ) as slot
  left join lateral (
    select
      match.id as match_id,
      concat_ws(' · ',
        championship.name,
        division.name,
        concat(team1.source_label, ' – ', team2.source_label)
      ) as display_name,
      division.display_color
    from public.reservations as reservation
    join public.championship_matches as match
      on match.id = reservation.championship_match_id
    join public.championship_divisions as division
      on division.id = match.division_id
    join public.championships as championship
      on championship.id = division.championship_id
    join public.championship_teams as team1 on team1.id = match.team1_id
    join public.championship_teams as team2 on team2.id = match.team2_id
    where reservation.resource_id = slot.resource_id
      and reservation.status in ('pending', 'confirmed')
      and reservation.starts_at < slot.ends_at
      and reservation.ends_at > slot.starts_at
    order by reservation.created_at desc
    limit 1
  ) as championship_slot on true
  order by slot.starts_at;
$$;

revoke all on function public.list_available_slots_v3(uuid, date, date)
from public, anon, authenticated;
grant execute on function public.list_available_slots_v3(uuid, date, date)
to anon, authenticated;

create or replace function public.get_public_tv_championship_slot_decorations(
  target_token uuid
)
returns table (
  resource_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  championship_name text,
  division_name text,
  match_label text,
  display_color text
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct
    reservation.resource_id,
    reservation.starts_at,
    reservation.ends_at,
    championship.name,
    division.name,
    concat(team1.source_label, ' – ', team2.source_label),
    division.display_color
  from public.club_tv_settings as settings
  join public.club_tv_resources as selected_resource
    on selected_resource.club_id = settings.club_id
  join public.reservations as reservation
    on reservation.resource_id = selected_resource.resource_id
   and reservation.status in ('pending', 'confirmed')
   and reservation.championship_match_id is not null
  join public.championship_matches as match
    on match.id = reservation.championship_match_id
  join public.championship_divisions as division
    on division.id = match.division_id
  join public.championships as championship
    on championship.id = division.championship_id
  join public.championship_teams as team1 on team1.id = match.team1_id
  join public.championship_teams as team2 on team2.id = match.team2_id
  where settings.public_token = target_token
    and settings.is_enabled
    and reservation.ends_at > (
      ((now() at time zone 'Europe/Paris')::date)::timestamp
      at time zone 'Europe/Paris'
    )
    and reservation.starts_at < (
      (((now() at time zone 'Europe/Paris')::date + 7)::timestamp)
      at time zone 'Europe/Paris'
    )
  order by reservation.starts_at, reservation.resource_id;
$$;

revoke all on function public.get_public_tv_championship_slot_decorations(uuid)
from public, anon, authenticated;
grant execute on function public.get_public_tv_championship_slot_decorations(uuid)
to anon, authenticated;

commit;
