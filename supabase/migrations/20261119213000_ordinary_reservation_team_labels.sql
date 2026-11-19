-- Optional participant labels for an ordinary reservation. No tournament/championship
-- record is fabricated, and the reservation owner/payment rules remain unchanged.
create table if not exists public.reservation_team_labels (
  reservation_id uuid primary key references public.reservations(id) on delete cascade,
  team_one text not null check (char_length(team_one) between 1 and 80 and team_one = btrim(team_one)),
  team_two text not null check (char_length(team_two) between 1 and 80 and team_two = btrim(team_two)),
  updated_at timestamptz not null default now(),
  constraint reservation_team_labels_distinct check (lower(team_one) <> lower(team_two))
);

alter table public.reservation_team_labels enable row level security;
revoke all on public.reservation_team_labels from public, anon, authenticated;
grant select, insert, update, delete on public.reservation_team_labels to service_role;

create or replace function public.set_my_reservation_team_labels(
  target_reservation_id uuid,
  requested_team_one text,
  requested_team_two text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  labels_one text := btrim(coalesce(requested_team_one, ''));
  labels_two text := btrim(coalesce(requested_team_two, ''));
begin
  if auth.uid() is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  if char_length(labels_one) < 1 or char_length(labels_one) > 80 or
     char_length(labels_two) < 1 or char_length(labels_two) > 80 or
     lower(labels_one) = lower(labels_two) or
     labels_one ~ '[[:cntrl:]]' or labels_two ~ '[[:cntrl:]]' then
    raise exception 'Renseignez deux noms d''équipes différents (80 caractères maximum)'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.reservations r
    where r.id = target_reservation_id
      and r.user_id = auth.uid()
      and r.championship_match_id is null
      and r.status in ('pending', 'confirmed')
  ) then
    raise exception 'Réservation ordinaire non autorisée' using errcode = '42501';
  end if;

  insert into public.reservation_team_labels (reservation_id, team_one, team_two)
  values (target_reservation_id, labels_one, labels_two)
  on conflict (reservation_id) do update
    set team_one = excluded.team_one,
        team_two = excluded.team_two,
        updated_at = now();
end;
$$;
revoke all on function public.set_my_reservation_team_labels(uuid,text,text) from public, anon;
grant execute on function public.set_my_reservation_team_labels(uuid,text,text) to authenticated;

-- The calendar already publishes the booker's name. This adds only the two
-- explicitly entered team names to active ordinary reservations.
create or replace function public.list_public_reservation_team_labels(
  target_resource_id uuid,
  range_start date,
  range_end date
)
returns table(resource_id uuid, starts_at timestamptz, team_one text, team_two text)
language sql stable security definer set search_path = ''
as $$
  select r.resource_id, r.starts_at, labels.team_one, labels.team_two
  from public.reservations r
  join public.reservation_team_labels labels on labels.reservation_id = r.id
  join public.reservable_resources resource on resource.id = r.resource_id
  where r.resource_id = target_resource_id
    and resource.is_active
    and r.status in ('pending', 'confirmed')
    and r.championship_match_id is null
    and r.starts_at >= range_start::timestamp at time zone resource.timezone
    and r.starts_at < (range_end + 1)::timestamp at time zone resource.timezone
  order by r.starts_at;
$$;
revoke all on function public.list_public_reservation_team_labels(uuid,date,date) from public;
grant execute on function public.list_public_reservation_team_labels(uuid,date,date) to anon, authenticated;
