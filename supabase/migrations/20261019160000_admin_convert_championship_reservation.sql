-- Club-scoped conversion: no cancellation, no duplicate booking, same reservation ID.
create or replace function public.admin_championship_matches_for_reservation(target_reservation_id uuid)
returns table(match_id uuid, label text, planned_date date)
language plpgsql stable security definer set search_path = ''
as $$
declare rec public.reservations%rowtype; target_club uuid;
begin
  select * into rec from public.reservations r where r.id=target_reservation_id;
  select rr.club_id into target_club from public.reservable_resources rr where rr.id=rec.resource_id;
  if rec.id is null or not public.has_club_permission(target_club,'reservations.manage')
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
        and fc.linked_club_id=target_club and l.federation_club_id in (t1.federation_club_id,t2.federation_club_id)
    )
    and not exists (
      select 1 from public.reservations existing
      where existing.championship_match_id=m.id and existing.status in ('pending','confirmed')
        and existing.id<>rec.id
    )
  order by (coalesce(m.report_on,m.agreement_on,m.scheduled_on) =
    (rec.starts_at at time zone (select rr.timezone from public.reservable_resources rr where rr.id=rec.resource_id))::date) desc,
    coalesce(m.report_on,m.agreement_on,m.scheduled_on) desc nulls last, ch.name, d.name, t1.source_label
  limit 300;
end $$;

create or replace function public.admin_convert_reservation_to_championship(
  target_reservation_id uuid, target_match_id uuid
) returns void language plpgsql security definer set search_path='' as $$
declare
  rec public.reservations%rowtype;
  club_id_target uuid;
  match_label text;
  match_championship_id uuid;
  match_status public.championship_status;
  match_team_a uuid;
  match_team_b uuid;
begin
  select * into rec from public.reservations where id=target_reservation_id for update;
  select rr.club_id into club_id_target from public.reservable_resources rr where rr.id=rec.resource_id;
  if rec.id is null or auth.uid() is null
    or not public.has_club_permission(club_id_target,'reservations.manage')
    or not public.has_club_permission(club_id_target,'championships.manage') then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  if rec.status not in ('pending','confirmed') or rec.championship_match_id is not null then
    raise exception 'Only an active ordinary reservation can be converted' using errcode='22023';
  end if;
  select ch.id,ch.status,t1.federation_club_id,t2.federation_club_id,
    concat_ws(' · ',ch.name,d.name,concat(t1.source_label,' – ',t2.source_label))
    into match_championship_id,match_status,match_team_a,match_team_b,match_label
  from public.championship_matches m
  join public.championship_divisions d on d.id=m.division_id
  join public.championships ch on ch.id=d.championship_id
  join public.championship_teams t1 on t1.id=m.team1_id
  join public.championship_teams t2 on t2.id=m.team2_id
  where m.id=target_match_id;
  if match_championship_id is null or match_status not in ('preparation','active')
    or not public.championship_club_can_manage(match_championship_id,club_id_target)
    or not exists(
      select 1 from public.championship_club_links l
      join public.championship_federation_clubs fc on fc.id=l.federation_club_id
      where l.championship_id=match_championship_id and l.club_id=club_id_target
        and fc.linked_club_id=club_id_target
        and l.federation_club_id in (match_team_a,match_team_b)
    ) then raise exception 'Championship match outside club scope' using errcode='42501'; end if;
  if exists(select 1 from public.reservations existing
    where existing.championship_match_id=target_match_id and existing.status in ('pending','confirmed')
    and existing.id<>rec.id) then
    raise exception 'This championship match already has an active reservation' using errcode='23505';
  end if;
  update public.reservations
    set championship_match_id=target_match_id,updated_at=now(),updated_by=auth.uid()
    where id=rec.id;
  update public.calendar_occupations
    set title=match_label,updated_at=now(),updated_by=auth.uid()
    where reservation_id=rec.id and cancelled_at is null;
  insert into public.reservation_audit_log(reservation_id,action,actor_id,previous_data,new_data)
    values(rec.id,'championship_match_linked',auth.uid(),
      jsonb_build_object('championship_match_id',rec.championship_match_id),
      jsonb_build_object('championship_match_id',target_match_id,'source','admin_conversion'));
end $$;
revoke all on function public.admin_championship_matches_for_reservation(uuid) from public,anon;
grant execute on function public.admin_championship_matches_for_reservation(uuid) to authenticated;
revoke all on function public.admin_convert_reservation_to_championship(uuid,uuid) from public,anon;
grant execute on function public.admin_convert_reservation_to_championship(uuid,uuid) to authenticated;
