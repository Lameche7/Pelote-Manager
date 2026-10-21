-- Atomic, club-scoped advance championship booking from a locked calendar slot.
create or replace function public.admin_calendar_championship_candidates(
  target_resource_id uuid, target_starts_at timestamptz, target_ends_at timestamptz
) returns table(match_id uuid, label text, planned_date date)
language plpgsql stable security definer set search_path = '' as $$
declare target_club uuid;
begin
  select club_id into target_club from public.reservable_resources where id=target_resource_id and is_active;
  if auth.uid() is null or target_club is null
    or not public.has_club_permission(target_club,'reservations.manage')
    or not public.has_club_permission(target_club,'championships.manage') then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  return query
  select m.id,
    concat_ws(' · ',ch.name,d.name,concat(t1.source_label,' – ',t2.source_label)),
    coalesce(m.report_on,m.agreement_on,m.scheduled_on)
  from public.championship_matches m
  join public.championship_divisions d on d.id=m.division_id
  join public.championships ch on ch.id=d.championship_id
  join public.championship_teams t1 on t1.id=m.team1_id
  join public.championship_teams t2 on t2.id=m.team2_id
  where ch.status in ('preparation','active')
    and public.championship_club_can_manage(ch.id,target_club)
    and exists (
      select 1 from public.championship_club_links l
      join public.championship_federation_clubs fc on fc.id=l.federation_club_id
      where l.championship_id=ch.id and l.club_id=target_club
        and fc.linked_club_id=target_club
        and l.federation_club_id in(t1.federation_club_id,t2.federation_club_id)
    )
    and not exists (
      select 1 from public.reservations r where r.championship_match_id=m.id
        and r.status in ('pending','confirmed')
    )
  order by (coalesce(m.report_on,m.agreement_on,m.scheduled_on) =
      (target_starts_at at time zone (select timezone from public.reservable_resources where id=target_resource_id))::date) desc,
    ch.name,d.name,t1.source_label
  limit 300;
end $$;

create or replace function public.admin_calendar_book_championship(
  target_resource_id uuid, target_starts_at timestamptz,
  target_ends_at timestamptz, target_match_id uuid
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  target_club uuid;
  match_label text;
  slot_status text;
  booking_id uuid;
  candidate_count integer;
  target_duration integer;
  expected_duration integer;
begin
  select rr.club_id into target_club from public.reservable_resources rr
    where rr.id=target_resource_id and rr.is_active for update;
  if auth.uid() is null or target_club is null
    or not public.has_club_permission(target_club,'reservations.manage')
    or not public.has_club_permission(target_club,'championships.manage') then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  if target_starts_at <= now() or target_ends_at <= target_starts_at then
    raise exception 'Créneau passé ou horaire invalide' using errcode='22023';
  end if;
  select default_duration_minutes into expected_duration from public.club_reservation_settings
    where club_id=target_club;
  target_duration := extract(epoch from (target_ends_at-target_starts_at))/60;
  if expected_duration is null or target_duration<>expected_duration then
    raise exception 'Durée incompatible avec le terrain' using errcode='22023';
  end if;
  select s.status into slot_status
    from public.list_available_slots_v4(
      target_resource_id,
      (target_starts_at at time zone (select timezone from public.reservable_resources where id=target_resource_id))::date,
      (target_starts_at at time zone (select timezone from public.reservable_resources where id=target_resource_id))::date
    ) s
    where s.starts_at=target_starts_at and s.ends_at=target_ends_at;
  if slot_status is distinct from 'locked' then
    raise exception 'Ce créneau n''est plus verrouillé ou disponible' using errcode='22023';
  end if;
  if exists(select 1 from public.calendar_occupations o
    where o.resource_id=target_resource_id and o.cancelled_at is null
      and tstzrange(o.starts_at,o.ends_at,'[)') && tstzrange(target_starts_at,target_ends_at,'[)')) then
    raise exception 'Créneau déjà occupé' using errcode='23P01';
  end if;
  select count(*),max(c.label) into candidate_count,match_label
    from public.admin_calendar_championship_candidates(target_resource_id,target_starts_at,target_ends_at) c
    where c.match_id=target_match_id;
  if candidate_count<>1 then
    raise exception 'Rencontre non autorisée ou déjà programmée' using errcode='42501';
  end if;
  insert into public.reservations(
    resource_id,customer_type,status,starts_at,ends_at,price_cents,
    payment_required,championship_match_id,created_by,updated_by
  ) values (
    target_resource_id,'guest','confirmed',target_starts_at,target_ends_at,0,
    false,target_match_id,auth.uid(),auth.uid()
  ) returning id into booking_id;
  insert into public.calendar_occupations(
    resource_id,occupation_type,reservation_id,title,starts_at,ends_at,created_by,updated_by
  ) values (
    target_resource_id,'reservation',booking_id,match_label,target_starts_at,target_ends_at,auth.uid(),auth.uid()
  );
  insert into public.reservation_audit_log(reservation_id,action,actor_id,new_data)
    values(booking_id,'admin_championship_advance_created',auth.uid(),
      jsonb_build_object('championship_match_id',target_match_id,'starts_at',target_starts_at,'ends_at',target_ends_at));
  return booking_id;
exception when exclusion_violation or unique_violation then
  raise exception 'Le créneau ou la rencontre vient d''être réservé' using errcode='23P01';
end $$;
revoke all on function public.admin_calendar_championship_candidates(uuid,timestamptz,timestamptz) from public,anon;
revoke all on function public.admin_calendar_book_championship(uuid,timestamptz,timestamptz,uuid) from public,anon;
grant execute on function public.admin_calendar_championship_candidates(uuid,timestamptz,timestamptz) to authenticated;
grant execute on function public.admin_calendar_book_championship(uuid,timestamptz,timestamptz,uuid) to authenticated;
