begin;

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
  target_resource_name text;
  target_team_id uuid;
  target_championship_id uuid;
  target_status public.championship_status;
  terms record;
  created_reservation public.reservations;
  match_label text;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into strict settings
  from public.reservation_settings
  where id;

  target_ends_at := target_starts_at
    + make_interval(mins => settings.default_duration_minutes);

  select resource.club_id, resource.name
  into target_club_id, target_resource_name
  from public.reservable_resources as resource
  where resource.id = target_resource_id
    and resource.is_active;

  if target_club_id is null then
    raise exception 'La ressource demandée est indisponible' using errcode = 'P0001';
  end if;

  select
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
  into target_team_id, target_championship_id, target_status, match_label
  from public.championship_matches as match
  join public.championship_divisions as division on division.id = match.division_id
  join public.championships as championship on championship.id = division.championship_id
  join public.championship_teams as team1 on team1.id = match.team1_id
  join public.championship_teams as team2 on team2.id = match.team2_id
  where match.id = target_match_id;

  if target_team_id is null
    or target_championship_id is null
    or target_status not in ('preparation', 'active')
  then
    raise exception 'Cette rencontre ne peut pas être réservée depuis ce compte'
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
    raise exception 'Cette rencontre n’est pas rattachée à ce club'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.reservations as reservation
    where reservation.championship_match_id = target_match_id
      and reservation.status in ('pending', 'confirmed')
  ) then
    raise exception 'Cette rencontre possède déjà une réservation active'
      using errcode = '23505';
  end if;

  select * into strict terms
  from public.assert_reservation_slot_allowed(
    target_resource_id,
    actor_id,
    target_starts_at,
    target_ends_at,
    null
  );

  insert into public.reservations (
    resource_id,
    user_id,
    customer_type,
    status,
    starts_at,
    ends_at,
    price_cents,
    payment_required,
    championship_match_id,
    created_by,
    updated_by
  ) values (
    target_resource_id,
    actor_id,
    terms.customer_type,
    'confirmed',
    target_starts_at,
    target_ends_at,
    0,
    false,
    target_match_id,
    actor_id,
    actor_id
  ) returning * into created_reservation;

  insert into public.calendar_occupations (
    resource_id,
    occupation_type,
    reservation_id,
    title,
    starts_at,
    ends_at,
    created_by,
    updated_by
  ) values (
    target_resource_id,
    'reservation',
    created_reservation.id,
    match_label,
    target_starts_at,
    target_ends_at,
    actor_id,
    actor_id
  );

  insert into public.reservation_audit_log (
    reservation_id,
    action,
    actor_id,
    new_data
  ) values (
    created_reservation.id,
    'championship_match_created',
    actor_id,
    jsonb_build_object(
      'championship_match_id', target_match_id,
      'resource_name', target_resource_name,
      'payment_required', false,
      'price_cents', 0
    )
  );

  return jsonb_build_object(
    'reservation_id', created_reservation.id,
    'championship_match_id', target_match_id,
    'resource_id', target_resource_id,
    'resource_name', target_resource_name,
    'starts_at', target_starts_at,
    'ends_at', target_ends_at,
    'price_cents', 0,
    'payment_required', false
  );
exception
  when exclusion_violation then
    raise exception 'Ce créneau vient d''être réservé par une autre personne'
      using errcode = '23P01';
end;
$$;

revoke all on function public.create_my_championship_match_reservation(uuid, uuid, timestamptz)
from public, anon, authenticated;
grant execute on function public.create_my_championship_match_reservation(uuid, uuid, timestamptz)
to authenticated;

commit;
