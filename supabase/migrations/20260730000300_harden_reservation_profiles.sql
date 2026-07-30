-- PR35: make profile creation independent from email-confirmation settings.
-- Auth metadata is the durable hand-off between signup and public.profiles.
create or replace function public.create_signup_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  identity jsonb := new.raw_user_meta_data -> 'pending_member_identity';
  given_name text := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'first_name'), ''),
    nullif(btrim(identity ->> 'firstName'), '')
  );
  family_name text := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'last_name'), ''),
    nullif(btrim(identity ->> 'lastName'), '')
  );
begin
  insert into public.profiles (id, email, first_name, last_name, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    given_name,
    family_name,
    nullif(btrim(concat_ws(' ', given_name, family_name)), '')
  )
  on conflict (id) do update
  set email = excluded.email,
      first_name = coalesce(excluded.first_name, public.profiles.first_name),
      last_name = coalesce(excluded.last_name, public.profiles.last_name),
      display_name = coalesce(excluded.display_name, public.profiles.display_name),
      updated_at = now();
  return new;
end;
$$;

drop trigger if exists create_profile_after_signup on auth.users;
create trigger create_profile_after_signup
after insert or update of raw_user_meta_data, email on auth.users
for each row execute function public.create_signup_profile();

-- Linking a licence also repairs legacy/incomplete profiles from the registry,
-- which remains authoritative for a linked member's identity.
create or replace function public.link_profile_to_member(
  licence_number text,
  last_name text,
  first_name text,
  birth_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_profile_id uuid := auth.uid();
  target_member public.club_members;
  linked_profile_id uuid;
begin
  if current_profile_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if nullif(btrim(licence_number), '') is null or nullif(btrim(last_name), '') is null
    or nullif(btrim(first_name), '') is null or birth_date is null
  then raise exception 'Complete member identity is required' using errcode = '22023'; end if;

  select * into target_member from public.club_members members
  where members.licence_number = link_profile_to_member.licence_number
    and members.last_name = link_profile_to_member.last_name
    and members.first_name = link_profile_to_member.first_name
    and members.birth_date = link_profile_to_member.birth_date
  for update;
  if target_member.id is null then raise exception 'Member identity does not match the club licence registry' using errcode = 'P0002'; end if;

  select id into linked_profile_id from public.profiles where member_id = target_member.id;
  if linked_profile_id is not null and linked_profile_id <> current_profile_id then
    raise exception 'Licence is already linked to another account' using errcode = '23505';
  end if;
  if not exists (select 1 from public.profiles where id = current_profile_id) then
    raise exception 'Current profile not found' using errcode = 'P0002';
  end if;

  perform set_config('app.allow_profile_member_link', 'on', true);
  update public.profiles
  set member_id = target_member.id,
      first_name = target_member.first_name,
      last_name = target_member.last_name,
      display_name = concat_ws(' ', target_member.first_name, target_member.last_name),
      updated_at = now()
  where id = current_profile_id;
  return target_member.id;
end;
$$;

revoke all on function public.link_profile_to_member(text, text, text, date) from public;
grant execute on function public.link_profile_to_member(text, text, text, date) to authenticated;

-- The previous function used `where id`, which attempts to use a UUID as a
-- boolean and made customer cancellation fail before any state was updated.
create or replace function public.cancel_my_reservation(target_reservation_id uuid)
returns table (
  reservation_id uuid,
  reservation_status public.reservation_status,
  payment_status public.payment_status,
  refund_required boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_row public.reservations;
  cancelled_row public.reservations;
  notice_hours integer;
  requires_refund boolean;
begin
  if auth.uid() is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  select * into reservation_row from public.reservations
  where id = target_reservation_id and user_id = auth.uid() for update;
  if reservation_row.id is null then raise exception 'Réservation introuvable' using errcode = 'P0002'; end if;
  if reservation_row.status not in ('pending', 'confirmed') then
    raise exception 'Cette réservation ne peut plus être annulée' using errcode = '22023';
  end if;

  select settings.cancellation_notice_hours into notice_hours
  from public.reservation_settings settings where settings.id = true;
  notice_hours := coalesce(notice_hours, 24);
  if now() > reservation_row.starts_at - make_interval(hours => notice_hours) then
    raise exception 'Le délai d’annulation en ligne est dépassé' using errcode = '22023';
  end if;
  requires_refund := reservation_row.payment_status = 'paid';

  update public.reservations set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
    cancellation_reason = 'Annulation en ligne par le réservant', updated_at = now(), updated_by = auth.uid()
  where id = target_reservation_id returning * into cancelled_row;
  update public.calendar_occupations set cancelled_at = coalesce(cancelled_at, now()), updated_at = now(), updated_by = auth.uid()
  where reservation_id = target_reservation_id and cancelled_at is null;
  update public.payments set status = 'cancelled', failure_reason = coalesce(failure_reason, 'Réservation annulée avant paiement'), updated_at = now()
  where reservation_id = target_reservation_id and status in ('pending', 'authorized');
  insert into public.reservation_audit_log(reservation_id, action, actor_id, previous_data, new_data)
  values(target_reservation_id, 'cancelled_by_customer', auth.uid(), to_jsonb(reservation_row), to_jsonb(cancelled_row));

  return query select target_reservation_id, 'cancelled'::public.reservation_status,
    case when requires_refund then 'paid'::public.payment_status else 'cancelled'::public.payment_status end,
    requires_refund;
end;
$$;

revoke all on function public.cancel_my_reservation(uuid) from public;
grant execute on function public.cancel_my_reservation(uuid) to authenticated;
