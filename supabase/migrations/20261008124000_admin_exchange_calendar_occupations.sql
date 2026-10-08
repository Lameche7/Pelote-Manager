-- Atomic universal swap of published calendar occupations.
-- Supported: standard/championship reservations and group-stage tournament matches.
-- Final-stage matches are intentionally blocked until final bracket synchronization is supported.
create or replace function public.admin_exchange_calendar_occupations(first_occupation_id uuid, second_occupation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 a public.calendar_occupations%rowtype; b public.calendar_occupations%rowtype;
 ar public.reservations%rowtype; br public.reservations%rowtype;
 atp public.tournament_match_planning%rowtype; btp public.tournament_match_planning%rowtype;
 amid uuid; bmid uuid;
 a_kind text; b_kind text; aid uuid;
 previous jsonb; current_state jsonb; exchange_id uuid;
 tz_a text; tz_b text;
begin
 if auth.uid() is null or not public.is_profile_admin() then
   raise exception 'Accès administrateur requis' using errcode='42501';
 end if;
 if first_occupation_id is null or second_occupation_id is null or first_occupation_id = second_occupation_id then
   raise exception 'Deux occupations différentes sont requises' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(719204, 1);
 select * into a from public.calendar_occupations where id=first_occupation_id for update;
 select * into b from public.calendar_occupations where id=second_occupation_id for update;
 if a.id is null or b.id is null or a.cancelled_at is not null or b.cancelled_at is not null
    or a.starts_at <= now() or b.starts_at <= now()
    or a.ends_at-a.starts_at <> b.ends_at-b.starts_at then
   raise exception 'Créneaux invalides, passés ou de durées différentes' using errcode='22023';
 end if;
 select timezone into tz_a from public.reservable_resources where id=a.resource_id and is_active;
 select timezone into tz_b from public.reservable_resources where id=b.resource_id and is_active;
 if tz_a is null or tz_b is null or tz_a <> tz_b
    or (select club_id from public.reservable_resources where id=a.resource_id)
       is distinct from (select club_id from public.reservable_resources where id=b.resource_id)
    or (select club_id from public.reservable_resources where id=a.resource_id)
       is distinct from public.admin_current_club_id() then
   raise exception 'Terrains incompatibles ou fuseaux horaires différents' using errcode='22023';
 end if;
 -- A published tournament event is identified by its event-resource projection.
 select tme.match_id into amid from public.event_resources er
 join public.tournament_match_events tme on tme.event_id=er.event_id
 join public.events e on e.id=tme.event_id and e.publication_status='published'
 where er.calendar_occupation_id=a.id;
 select tme.match_id into bmid from public.event_resources er
 join public.tournament_match_events tme on tme.event_id=er.event_id
 join public.events e on e.id=tme.event_id and e.publication_status='published'
 where er.calendar_occupation_id=b.id;
 a_kind:=case when amid is not null then 'tournament' when a.occupation_type='reservation' then 'reservation' else 'unsupported' end;
 b_kind:=case when bmid is not null then 'tournament' when b.occupation_type='reservation' then 'reservation' else 'unsupported' end;
 if a_kind='unsupported' or b_kind='unsupported' then
   raise exception 'Type d’occupation non échangeable' using errcode='22023';
 end if;
 if a_kind='reservation' then
   select * into ar from public.reservations where id=a.reservation_id for update;
   if ar.id is null or ar.status <> 'confirmed' or ar.resource_id<>a.resource_id
     or ar.starts_at<>a.starts_at or ar.ends_at<>a.ends_at then
     raise exception 'Réservation A non confirmée ou désynchronisée' using errcode='22023';
   end if;
 else
   select * into atp from public.tournament_match_planning where match_id=amid for update;
   if atp.match_id is null or not exists
      (select 1 from public.tournaments t where t.id=atp.tournament_id
       and t.club_id=public.admin_current_club_id())
     or atp.resource_id<>a.resource_id
     or public.tournament_planning_starts_at(atp.play_date,atp.starts_at,tz_a)<>a.starts_at
     or public.tournament_planning_starts_at(atp.play_date,atp.ends_at,tz_a)<>a.ends_at
     or exists(select 1 from public.tournament_matches m where m.id=amid and (m.phase='finals' or m.status <> 'scheduled')) then
     raise exception 'Planning tournoi A incompatible ou phase finale' using errcode='22023';
   end if;
 end if;
 if b_kind='reservation' then
   select * into br from public.reservations where id=b.reservation_id for update;
   if br.id is null or br.status <> 'confirmed' or br.resource_id<>b.resource_id
     or br.starts_at<>b.starts_at or br.ends_at<>b.ends_at then
     raise exception 'Réservation B non confirmée ou désynchronisée' using errcode='22023';
   end if;
 else
   select * into btp from public.tournament_match_planning where match_id=bmid for update;
   if btp.match_id is null or not exists
      (select 1 from public.tournaments t where t.id=btp.tournament_id
       and t.club_id=public.admin_current_club_id())
     or btp.resource_id<>b.resource_id
     or public.tournament_planning_starts_at(btp.play_date,btp.starts_at,tz_b)<>b.starts_at
     or public.tournament_planning_starts_at(btp.play_date,btp.ends_at,tz_b)<>b.ends_at
     or exists(select 1 from public.tournament_matches m where m.id=bmid and (m.phase='finals' or m.status <> 'scheduled')) then
     raise exception 'Planning tournoi B incompatible ou phase finale' using errcode='22023';
   end if;
 end if;
 previous:=jsonb_build_object('first',to_jsonb(a),'second',to_jsonb(b));
 -- Release both occupied slots within the same transaction before republishing.
 update public.calendar_occupations set cancelled_at=now() where id in (a.id,b.id);
 -- The tournament sync helper deletes and recreates its projection. Its own
 -- original slot is released above; the other side stays released until sync.

 if a_kind='reservation' then
   update public.reservations set resource_id=b.resource_id,starts_at=b.starts_at,ends_at=b.ends_at,
     updated_by=auth.uid(),updated_at=now() where id=ar.id;
   if ar.championship_match_id is not null then
     insert into public.championship_match_manual_schedules(match_id,scheduled_on,scheduled_time,updated_by,updated_at)
     values(ar.championship_match_id,(b.starts_at at time zone tz_b)::date,(b.starts_at at time zone tz_b)::time,auth.uid(),now())
     on conflict(match_id) do update set scheduled_on=excluded.scheduled_on,scheduled_time=excluded.scheduled_time,updated_by=excluded.updated_by,updated_at=now();
   end if;
   update public.calendar_occupations set resource_id=b.resource_id,starts_at=b.starts_at,ends_at=b.ends_at,
     cancelled_at=null,updated_by=auth.uid(),updated_at=now() where id=a.id;
 else
   update public.tournament_match_planning set resource_id=b.resource_id,
     play_date=(b.starts_at at time zone tz_b)::date,
     starts_at=(b.starts_at at time zone tz_b)::time,
     ends_at=(b.ends_at at time zone tz_b)::time,source='manual',updated_at=now() where match_id=amid;
   perform public.sync_tournament_reschedule_match_event(amid,b.resource_id,
     (b.starts_at at time zone tz_b)::date,(b.starts_at at time zone tz_b)::time,
     (b.ends_at at time zone tz_b)::time);
 end if;
 if b_kind='reservation' then
   update public.reservations set resource_id=a.resource_id,starts_at=a.starts_at,ends_at=a.ends_at,
     updated_by=auth.uid(),updated_at=now() where id=br.id;
   if br.championship_match_id is not null then
     insert into public.championship_match_manual_schedules(match_id,scheduled_on,scheduled_time,updated_by,updated_at)
     values(br.championship_match_id,(a.starts_at at time zone tz_a)::date,(a.starts_at at time zone tz_a)::time,auth.uid(),now())
     on conflict(match_id) do update set scheduled_on=excluded.scheduled_on,scheduled_time=excluded.scheduled_time,updated_by=excluded.updated_by,updated_at=now();
   end if;
   update public.calendar_occupations set resource_id=a.resource_id,starts_at=a.starts_at,ends_at=a.ends_at,
     cancelled_at=null,updated_by=auth.uid(),updated_at=now() where id=b.id;
 else
   update public.tournament_match_planning set resource_id=a.resource_id,
     play_date=(a.starts_at at time zone tz_a)::date,
     starts_at=(a.starts_at at time zone tz_a)::time,
     ends_at=(a.ends_at at time zone tz_a)::time,source='manual',updated_at=now() where match_id=bmid;
   perform public.sync_tournament_reschedule_match_event(bmid,a.resource_id,
     (a.starts_at at time zone tz_a)::date,(a.starts_at at time zone tz_a)::time,
     (a.ends_at at time zone tz_a)::time);
 end if;
 -- Tournament synchronization recreates calendar occupation IDs.
 -- Verify by the underlying business object, not the original projection ID.
 if a_kind='tournament' then
   if not exists (
     select 1 from public.tournament_match_planning p
     join public.tournament_match_events link on link.match_id=p.match_id
     join public.event_resources er on er.event_id=link.event_id
     join public.calendar_occupations c on c.id=er.calendar_occupation_id
     where p.match_id=amid and c.cancelled_at is null
       and c.resource_id=b.resource_id and c.starts_at=b.starts_at and c.ends_at=b.ends_at
   ) then raise exception 'Projection tournoi A non synchronisée'; end if;
 else
   if not exists (select 1 from public.calendar_occupations c
     where c.id=a.id and c.cancelled_at is null
       and c.resource_id=b.resource_id and c.starts_at=b.starts_at and c.ends_at=b.ends_at)
   then raise exception 'Projection réservation A non synchronisée'; end if;
 end if;
 if b_kind='tournament' then
   if not exists (
     select 1 from public.tournament_match_planning p
     join public.tournament_match_events link on link.match_id=p.match_id
     join public.event_resources er on er.event_id=link.event_id
     join public.calendar_occupations c on c.id=er.calendar_occupation_id
     where p.match_id=bmid and c.cancelled_at is null
       and c.resource_id=a.resource_id and c.starts_at=a.starts_at and c.ends_at=a.ends_at
   ) then raise exception 'Projection tournoi B non synchronisée'; end if;
 else
   if not exists (select 1 from public.calendar_occupations c
     where c.id=b.id and c.cancelled_at is null
       and c.resource_id=a.resource_id and c.starts_at=a.starts_at and c.ends_at=a.ends_at)
   then raise exception 'Projection réservation B non synchronisée'; end if;
 end if;
 current_state:=jsonb_build_object(
   'first',jsonb_build_object('kind',a_kind,'reservation_id',ar.id,'tournament_match_id',amid,
      'resource_id',b.resource_id,'starts_at',b.starts_at,'ends_at',b.ends_at),
   'second',jsonb_build_object('kind',b_kind,'reservation_id',br.id,'tournament_match_id',bmid,
      'resource_id',a.resource_id,'starts_at',a.starts_at,'ends_at',a.ends_at));
 insert into public.admin_slot_exchange_audit(actor_id,first_occupation_id,second_occupation_id,before_state,after_state)
 values(auth.uid(),a.id,b.id,previous,current_state) returning id into exchange_id;
 return jsonb_build_object('status','exchanged','exchange_id',exchange_id,'first',a.id,'second',b.id);
exception when exclusion_violation then
 raise exception 'Conflit de planning : aucun échange effectué' using errcode='23P01';
end;
$$;
revoke all on function public.admin_exchange_calendar_occupations(uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_exchange_calendar_occupations(uuid,uuid) to authenticated;
