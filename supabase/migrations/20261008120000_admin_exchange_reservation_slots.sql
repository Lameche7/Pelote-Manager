begin;

-- Première opération réelle : échange de deux réservations classiques.
-- Les autres catégories exigent leurs propres commandes métier.
create table if not exists public.admin_slot_exchange_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id),
  first_occupation_id uuid not null,
  second_occupation_id uuid not null,
  before_state jsonb not null,
  after_state jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.admin_slot_exchange_audit enable row level security;
revoke all on public.admin_slot_exchange_audit from public, anon, authenticated;

create or replace function public.admin_exchange_reservation_slots(
  first_occupation_id uuid,
  second_occupation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.calendar_occupations%rowtype;
  b public.calendar_occupations%rowtype;
  ra public.reservations%rowtype;
  rb public.reservations%rowtype;
  previous jsonb;
  exchange_id uuid;
  current_state jsonb;
  actor uuid := auth.uid();
begin
  if actor is null or not public.is_profile_admin() then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;
  if first_occupation_id is null or second_occupation_id is null
    or first_occupation_id = second_occupation_id then
    raise exception 'Sélectionnez deux occupations différentes' using errcode = '22023';
  end if;

  -- Serialise all admin swaps, including concurrent swaps involving different rows.
  perform pg_advisory_xact_lock(719204, 1);
  select * into a from public.calendar_occupations
    where id = first_occupation_id for update;
  select * into b from public.calendar_occupations
    where id = second_occupation_id for update;
  if a.id is null or b.id is null
    or a.cancelled_at is not null or b.cancelled_at is not null
    or a.occupation_type <> 'reservation' or b.occupation_type <> 'reservation'
    or a.reservation_id is null or b.reservation_id is null then
    raise exception 'Seules deux réservations classiques actives sont échangeables dans cette version'
      using errcode = '22023';
  end if;
  if a.starts_at <= now() or b.starts_at <= now()
    or a.ends_at - a.starts_at <> b.ends_at - b.starts_at then
    raise exception 'Créneaux passés ou durées incompatibles' using errcode = '22023';
  end if;
  select * into ra from public.reservations where id = a.reservation_id for update;
  select * into rb from public.reservations where id = b.reservation_id for update;
  if ra.id is null or rb.id is null or ra.status <> 'confirmed' or rb.status <> 'confirmed'
    or ra.championship_match_id is not null or rb.championship_match_id is not null
    or ra.resource_id <> a.resource_id or rb.resource_id <> b.resource_id
    or ra.starts_at <> a.starts_at or rb.starts_at <> b.starts_at
    or ra.ends_at <> a.ends_at or rb.ends_at <> b.ends_at then
    raise exception 'Réservations non confirmées ou désynchronisées' using errcode = '22023';
  end if;
  if not exists (select 1 from public.reservable_resources where id = a.resource_id and is_active)
    or not exists (select 1 from public.reservable_resources where id = b.resource_id and is_active) then
    raise exception 'Terrain inactif' using errcode = '22023';
  end if;
  previous := jsonb_build_object('first', to_jsonb(a), 'second', to_jsonb(b));

  -- Remove only the two occupations from the exclusion constraint temporarily.
  -- Any failure rolls back the entire transaction.
  update public.calendar_occupations
    set cancelled_at = now(), updated_at = now(), updated_by = actor
    where id in (a.id, b.id);
  update public.reservations
    set resource_id = b.resource_id, starts_at = b.starts_at, ends_at = b.ends_at,
        updated_at = now(), updated_by = actor
    where id = ra.id;
  update public.reservations
    set resource_id = a.resource_id, starts_at = a.starts_at, ends_at = a.ends_at,
        updated_at = now(), updated_by = actor
    where id = rb.id;
  update public.calendar_occupations
    set resource_id = b.resource_id, starts_at = b.starts_at, ends_at = b.ends_at,
        cancelled_at = null, updated_at = now(), updated_by = actor
    where id = a.id;
  update public.calendar_occupations
    set resource_id = a.resource_id, starts_at = a.starts_at, ends_at = a.ends_at,
        cancelled_at = null, updated_at = now(), updated_by = actor
    where id = b.id;

  current_state := jsonb_build_object(
    'first', (select to_jsonb(c) from public.calendar_occupations c where c.id = a.id),
    'second', (select to_jsonb(c) from public.calendar_occupations c where c.id = b.id)
  );
  insert into public.admin_slot_exchange_audit
    (actor_id, first_occupation_id, second_occupation_id, before_state, after_state)
    values (actor, a.id, b.id, previous, current_state) returning id into exchange_id;
  insert into public.reservation_audit_log (reservation_id, action, actor_id, previous_data, new_data)
    values (ra.id, 'admin_slot_exchange', actor, to_jsonb(ra),
      (select to_jsonb(r) from public.reservations r where r.id = ra.id)),
           (rb.id, 'admin_slot_exchange', actor, to_jsonb(rb),
      (select to_jsonb(r) from public.reservations r where r.id = rb.id));
  return jsonb_build_object('status', 'exchanged', 'first', a.id, 'second', b.id, 'exchange_id', exchange_id);
exception
  when exclusion_violation then
    raise exception 'Conflit avec une autre occupation : échange annulé' using errcode = '23P01';
end;
$$;
revoke all on function public.admin_exchange_reservation_slots(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_exchange_reservation_slots(uuid, uuid) to authenticated;
commit;
