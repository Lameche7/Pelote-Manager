-- Daily reservation administration. Every entry point is deliberately guarded in SQL.
create function public.admin_manage_reservations(
  search_text text default null, resource_filter uuid default null,
  status_filter public.reservation_status default null,
  customer_filter public.reservation_customer_type default null,
  range_start timestamptz default null, range_end timestamptz default null
)
returns table (id uuid, resource_id uuid, resource_name text, customer_name text,
  customer_email text, customer_type public.reservation_customer_type,
  status public.reservation_status, payment_status public.payment_status,
  starts_at timestamptz, ends_at timestamptz, price_cents integer, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_profile_admin() then raise exception 'Accès administrateur requis' using errcode = '42501'; end if;
  return query select r.id, r.resource_id, rr.name,
    coalesce(nullif(btrim(concat_ws(' ', cm.first_name, cm.last_name)), ''), p.display_name, r.guest_name, 'Réservation'),
    coalesce(p.email, r.guest_email, ''), r.customer_type, r.status, r.payment_status,
    r.starts_at, r.ends_at, r.price_cents, r.created_at
  from public.reservations r join public.reservable_resources rr on rr.id = r.resource_id
  left join public.profiles p on p.id = r.user_id left join public.club_members cm on cm.id = p.member_id
  where (resource_filter is null or r.resource_id = resource_filter)
    and (status_filter is null or r.status = status_filter)
    and (customer_filter is null or r.customer_type = customer_filter)
    and (range_start is null or r.starts_at >= range_start) and (range_end is null or r.starts_at < range_end)
    and (nullif(btrim(search_text), '') is null or coalesce(cm.first_name || ' ' || cm.last_name, p.display_name, r.guest_name, '') ilike '%' || btrim(search_text) || '%' or coalesce(p.email, r.guest_email, '') ilike '%' || btrim(search_text) || '%')
  order by r.starts_at desc;
end $$;

create function public.admin_search_reservation_users(search_text text)
returns table (id uuid, name text, email text, license_number text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_profile_admin() then raise exception 'Accès administrateur requis' using errcode = '42501'; end if;
  if length(btrim(coalesce(search_text, ''))) < 2 then return; end if;
  return query select p.id, coalesce(nullif(btrim(concat_ws(' ', cm.first_name, cm.last_name)), ''), p.display_name, p.email, 'Utilisateur'), p.email, coalesce(cm.licence_number, '')
  from public.profiles p left join public.club_members cm on cm.id = p.member_id
  where p.email ilike '%' || btrim(search_text) || '%' or p.display_name ilike '%' || btrim(search_text) || '%'
    or cm.first_name ilike '%' || btrim(search_text) || '%' or cm.last_name ilike '%' || btrim(search_text) || '%' or cm.licence_number ilike '%' || btrim(search_text) || '%'
  order by 2 limit 20;
end $$;

create function public.admin_create_reservation_for_user(target_user_id uuid, target_resource_id uuid, target_starts_at timestamptz)
returns public.reservations language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); settings public.reservation_settings%rowtype; target_ends_at timestamptz; terms record; created public.reservations;
begin
  if not public.is_profile_admin() then raise exception 'Accès administrateur requis' using errcode = '42501'; end if;
  if target_user_id is null or not exists(select 1 from public.profiles where id = target_user_id) then raise exception 'Un compte utilisateur existant est obligatoire' using errcode = '22023'; end if;
  select * into strict settings from public.reservation_settings where id;
  target_ends_at := target_starts_at + make_interval(mins => settings.default_duration_minutes);
  select * into strict terms from public.assert_reservation_slot_allowed(target_resource_id, target_user_id, target_starts_at, target_ends_at, null);
  insert into public.reservations(resource_id,user_id,customer_type,status,starts_at,ends_at,price_cents,created_by,updated_by)
    values(target_resource_id,target_user_id,terms.customer_type,'confirmed',target_starts_at,target_ends_at,terms.price_cents,actor,actor) returning * into created;
  insert into public.calendar_occupations(resource_id,occupation_type,reservation_id,title,starts_at,ends_at,created_by,updated_by)
    values(target_resource_id,'reservation',created.id,'Réservation',target_starts_at,target_ends_at,actor,actor);
  insert into public.reservation_audit_log(reservation_id,action,actor_id,new_data) values(created.id,'admin_created_for_user',actor,to_jsonb(created));
  return created;
exception when exclusion_violation then raise exception 'Ce créneau est déjà occupé' using errcode = '23P01';
end $$;

revoke all on function public.admin_manage_reservations(text,uuid,public.reservation_status,public.reservation_customer_type,timestamptz,timestamptz) from public;
revoke all on function public.admin_search_reservation_users(text) from public;
revoke all on function public.admin_create_reservation_for_user(uuid,uuid,timestamptz) from public;
grant execute on function public.admin_manage_reservations(text,uuid,public.reservation_status,public.reservation_customer_type,timestamptz,timestamptz) to authenticated;
grant execute on function public.admin_search_reservation_users(text) to authenticated;
grant execute on function public.admin_create_reservation_for_user(uuid,uuid,timestamptz) to authenticated;

create table public.calendar_occupation_audit_log (
  id bigint generated always as identity primary key,
  occupation_id uuid not null references public.calendar_occupations(id),
  action text not null check (btrim(action) <> ''), actor_id uuid references public.profiles(id),
  previous_data jsonb, new_data jsonb, created_at timestamptz not null default now()
);
alter table public.calendar_occupation_audit_log enable row level security;
create policy calendar_occupation_audit_admin_read on public.calendar_occupation_audit_log for select to authenticated using (public.is_profile_admin());

create function public.admin_list_available_reservation_slots(target_resource_id uuid, target_date date, excluded_reservation_id uuid default null)
returns table(starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_profile_admin() then raise exception 'Accès administrateur requis' using errcode = '42501'; end if;
  return query select slot.starts_at, slot.ends_at from public.list_available_slots(target_resource_id, target_date, target_date) slot
  where slot.status = 'available' or (excluded_reservation_id is not null and not exists (
    select 1 from public.calendar_occupations occupation where occupation.resource_id = target_resource_id
      and occupation.cancelled_at is null and occupation.reservation_id is distinct from excluded_reservation_id
      and occupation.starts_at < slot.ends_at and occupation.ends_at > slot.starts_at
  )) order by slot.starts_at;
end $$;

create function public.admin_preview_reservation(target_user_id uuid, target_resource_id uuid, target_starts_at timestamptz)
returns table(customer_type public.reservation_customer_type, price_cents integer, ends_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare settings public.reservation_settings%rowtype; terms record; calculated_end timestamptz;
begin
  if not public.is_profile_admin() then raise exception 'Accès administrateur requis' using errcode = '42501'; end if;
  if target_user_id is null or not exists(select 1 from public.profiles where id = target_user_id) then raise exception 'Un compte utilisateur existant est obligatoire' using errcode = '22023'; end if;
  select * into strict settings from public.reservation_settings where id; calculated_end := target_starts_at + make_interval(mins => settings.default_duration_minutes);
  select * into strict terms from public.assert_reservation_slot_allowed(target_resource_id,target_user_id,target_starts_at,calculated_end,null);
  return query select terms.customer_type, terms.price_cents, calculated_end;
end $$;

create function public.admin_list_calendar_blocks()
returns table(id uuid, resource_id uuid, resource_name text, title text, starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_profile_admin() then raise exception 'Accès administrateur requis' using errcode = '42501'; end if;
  return query select occupation.id, occupation.resource_id, resource.name, occupation.title, occupation.starts_at, occupation.ends_at
    from public.calendar_occupations occupation join public.reservable_resources resource on resource.id = occupation.resource_id
    where occupation.occupation_type <> 'reservation' and occupation.cancelled_at is null and occupation.ends_at >= now()
    order by occupation.starts_at;
end $$;

create function public.admin_create_calendar_block(target_resource_id uuid, target_title text, target_starts_at timestamptz, target_ends_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); created public.calendar_occupations;
begin
  if not public.is_profile_admin() then raise exception 'Accès administrateur requis' using errcode = '42501'; end if;
  if nullif(btrim(target_title),'') is null or target_ends_at <= target_starts_at then raise exception 'Blocage invalide' using errcode = '22023'; end if;
  insert into public.calendar_occupations(resource_id,occupation_type,title,starts_at,ends_at,created_by,updated_by)
    values(target_resource_id,'closure',btrim(target_title),target_starts_at,target_ends_at,actor,actor) returning * into created;
  insert into public.calendar_occupation_audit_log(occupation_id,action,actor_id,new_data) values(created.id,'created',actor,to_jsonb(created)); return created.id;
exception when exclusion_violation then raise exception 'Ce créneau est déjà occupé' using errcode = '23P01';
end $$;

create function public.admin_update_calendar_block(target_id uuid, target_title text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); previous public.calendar_occupations; changed public.calendar_occupations;
begin
  if not public.is_profile_admin() then raise exception 'Accès administrateur requis' using errcode = '42501'; end if;
  if nullif(btrim(target_title),'') is null then raise exception 'Un motif est obligatoire' using errcode = '22023'; end if;
  select * into previous from public.calendar_occupations where id=target_id and occupation_type <> 'reservation' and cancelled_at is null for update;
  if previous.id is null then raise exception 'Blocage introuvable' using errcode = 'P0002'; end if;
  update public.calendar_occupations set title=btrim(target_title),updated_at=now(),updated_by=actor where id=target_id returning * into changed;
  insert into public.calendar_occupation_audit_log(occupation_id,action,actor_id,previous_data,new_data) values(target_id,'updated',actor,to_jsonb(previous),to_jsonb(changed));
end $$;

create function public.admin_delete_calendar_block(target_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); previous public.calendar_occupations; changed public.calendar_occupations;
begin
  if not public.is_profile_admin() then raise exception 'Accès administrateur requis' using errcode = '42501'; end if;
  select * into previous from public.calendar_occupations where id=target_id and occupation_type <> 'reservation' and cancelled_at is null for update;
  if previous.id is null then raise exception 'Blocage introuvable' using errcode = 'P0002'; end if;
  update public.calendar_occupations set cancelled_at=now(),updated_at=now(),updated_by=actor where id=target_id returning * into changed;
  insert into public.calendar_occupation_audit_log(occupation_id,action,actor_id,previous_data,new_data) values(target_id,'cancelled',actor,to_jsonb(previous),to_jsonb(changed));
end $$;

revoke all on table public.calendar_occupation_audit_log from public, anon, authenticated;
revoke all on function public.admin_list_available_reservation_slots(uuid,date,uuid) from public;
revoke all on function public.admin_preview_reservation(uuid,uuid,timestamptz) from public;
revoke all on function public.admin_list_calendar_blocks() from public;
revoke all on function public.admin_create_calendar_block(uuid,text,timestamptz,timestamptz) from public;
revoke all on function public.admin_update_calendar_block(uuid,text) from public;
revoke all on function public.admin_delete_calendar_block(uuid) from public;
grant execute on function public.admin_list_available_reservation_slots(uuid,date,uuid) to authenticated;
grant execute on function public.admin_preview_reservation(uuid,uuid,timestamptz) to authenticated;
grant execute on function public.admin_list_calendar_blocks() to authenticated;
grant execute on function public.admin_create_calendar_block(uuid,text,timestamptz,timestamptz) to authenticated;
grant execute on function public.admin_update_calendar_block(uuid,text) to authenticated;
grant execute on function public.admin_delete_calendar_block(uuid) to authenticated;
