begin;

-- Un club qui n'a encore rien choisi conserve le comportement habituel :
-- la gratuité d'une rencontre doit être une décision explicite de l'admin.
alter table public.championship_reservation_settings
  alter column match_payment_mode set default 'standard';

update public.championship_reservation_settings
set match_payment_mode = 'standard'
where match_payment_mode is distinct from 'standard';

insert into public.championship_reservation_settings (
  club_id,
  enabled,
  advance_days,
  max_active_reservations,
  match_payment_mode
)
select
  club.id,
  false,
  90,
  20,
  'standard'
from public.clubs as club
where not exists (
  select 1
  from public.championship_reservation_settings as settings
  where settings.club_id = club.id
);

create or replace function public.initialize_championship_reservation_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.championship_reservation_settings (
    club_id,
    enabled,
    advance_days,
    max_active_reservations,
    match_payment_mode
  ) values (
    new.id,
    false,
    90,
    20,
    'standard'
  )
  on conflict (club_id) do nothing;

  return new;
end;
$$;

revoke all on function public.initialize_championship_reservation_settings()
from public, anon, authenticated;

drop trigger if exists initialize_championship_reservation_settings
on public.clubs;
create trigger initialize_championship_reservation_settings
after insert on public.clubs
for each row
execute function public.initialize_championship_reservation_settings();

-- Une rencontre est un objet d'équipe : si un coéquipier a réservé,
-- tous les joueurs liés à l'une des deux équipes voient immédiatement le créneau.
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
  where reservation.championship_match_id is not null
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

commit;
