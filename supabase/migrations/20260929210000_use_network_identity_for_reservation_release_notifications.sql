begin;

create or replace function public.publish_released_reservation_slot_notification(
  target_reservation_id uuid,
  excluded_profile_id uuid default null
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare reservation_row public.reservations; resource_row public.reservable_resources; created_communication_id uuid; local_slot text;
begin
  select * into reservation_row from public.reservations where id = target_reservation_id;
  if reservation_row.id is null or reservation_row.starts_at <= now() then return null; end if;
  select * into resource_row from public.reservable_resources where id = reservation_row.resource_id;
  if resource_row.id is null then return null; end if;
  local_slot := to_char(reservation_row.starts_at at time zone resource_row.timezone,'DD/MM/YYYY "à" HH24:MI');
  insert into public.club_communications(club_id,title,body,priority,status,show_on_home,published_at,expires_at,created_by,updated_by)
  values(resource_row.club_id,'Créneau libéré · '||resource_row.name,'Un créneau vient de se libérer le '||local_slot||' au '||resource_row.name||'. Il est de nouveau disponible à la réservation.','normal','published',false,now(),reservation_row.starts_at,excluded_profile_id,excluded_profile_id)
  returning id into created_communication_id;
  insert into public.communication_deliveries(communication_id,club_id,club_member_id,profile_id_at_publication,email_snapshot,email_status)
  select created_communication_id,resource_row.club_id,member.id,profile.id,coalesce(nullif(btrim(member.email),''),nullif(btrim(profile.email),'')),
    case when coalesce(nullif(btrim(member.email),''),nullif(btrim(profile.email),'')) is null then 'unavailable'::public.communication_email_status else 'not_configured'::public.communication_email_status end
  from public.club_members member
  left join public.profiles profile on profile.id = public.club_member_profile_id(member.id)
  where member.club_id=resource_row.club_id and member.is_active and (excluded_profile_id is null or profile.id is distinct from excluded_profile_id)
  on conflict (communication_id,club_member_id) do nothing;
  insert into public.communication_audit_log(club_id,communication_id,action,actor_id,new_data)
  values(resource_row.club_id,created_communication_id,'published',excluded_profile_id,jsonb_build_object('source','reservation_cancelled','reservation_id',target_reservation_id,'recipient_count',(select count(*) from public.communication_deliveries delivery where delivery.communication_id=created_communication_id)));
  return created_communication_id;
end;$$;

create or replace function public.publish_released_permanent_slot_notification(target_occurrence_id uuid,excluded_profile_id uuid default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare target record; created_communication_id uuid; local_slot text;
begin
 select occurrence.id occurrence_id,occurrence.status,slot.id permanent_slot_id,slot.club_id,occupation.starts_at,occupation.ends_at,resource.id resource_id,resource.name resource_name,resource.timezone resource_timezone
 into target from public.permanent_slot_occurrences occurrence join public.permanent_slots slot on slot.id=occurrence.permanent_slot_id and slot.is_active join public.calendar_occupations occupation on occupation.id=occurrence.occupation_id join public.reservable_resources resource on resource.id=slot.resource_id
 where occurrence.id=target_occurrence_id and occurrence.status='released'::public.permanent_slot_occurrence_status;
 if not found or target.starts_at<=now() then return null; end if;
 local_slot:=to_char(target.starts_at at time zone target.resource_timezone,'DD/MM/YYYY "à" HH24:MI');
 insert into public.club_communications(club_id,title,body,priority,status,show_on_home,published_at,expires_at,created_by,updated_by)
 values(target.club_id,'Créneau libéré · '||target.resource_name,'Un créneau permanent vient de se libérer le '||local_slot||' au '||target.resource_name||'. Il est maintenant disponible à la réservation.','normal','published',false,now(),target.starts_at,excluded_profile_id,excluded_profile_id) returning id into created_communication_id;
 insert into public.communication_deliveries(communication_id,club_id,club_member_id,profile_id_at_publication,email_snapshot,email_status)
 select created_communication_id,target.club_id,member.id,profile.id,coalesce(nullif(btrim(member.email),''),nullif(btrim(profile.email),'')),
 case when coalesce(nullif(btrim(member.email),''),nullif(btrim(profile.email),'')) is null then 'unavailable'::public.communication_email_status else 'not_configured'::public.communication_email_status end
 from public.club_members member join public.profiles profile on profile.id=public.club_member_profile_id(member.id)
 where member.club_id=target.club_id and member.is_active and (excluded_profile_id is null or profile.id<>excluded_profile_id)
 on conflict (communication_id,club_member_id) do nothing;
 insert into public.communication_audit_log(club_id,communication_id,action,actor_id,new_data)
 values(target.club_id,created_communication_id,'published',excluded_profile_id,jsonb_build_object('source','permanent_slot_released','permanent_slot_id',target.permanent_slot_id,'occurrence_id',target.occurrence_id,'recipient_count',(select count(*) from public.communication_deliveries delivery where delivery.communication_id=created_communication_id)));
 return created_communication_id;
end;$$;

commit;
