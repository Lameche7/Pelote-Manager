begin;

create or replace function public.publish_released_permanent_slot_notification(
  target_occurrence_id uuid,
  excluded_profile_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
  created_communication_id uuid;
  local_slot text;
begin
  select
    occurrence.id as occurrence_id,
    occurrence.status,
    slot.id as permanent_slot_id,
    slot.club_id,
    occupation.starts_at,
    occupation.ends_at,
    resource.id as resource_id,
    resource.name as resource_name,
    resource.timezone as resource_timezone
  into target
  from public.permanent_slot_occurrences as occurrence
  join public.permanent_slots as slot
    on slot.id = occurrence.permanent_slot_id
   and slot.is_active
  join public.calendar_occupations as occupation
    on occupation.id = occurrence.occupation_id
  join public.reservable_resources as resource
    on resource.id = slot.resource_id
  where occurrence.id = target_occurrence_id
    and occurrence.status = 'released'::public.permanent_slot_occurrence_status;

  if not found or target.starts_at <= now() then
    return null;
  end if;

  local_slot := to_char(
    target.starts_at at time zone target.resource_timezone,
    'DD/MM/YYYY "à" HH24:MI'
  );

  insert into public.club_communications (
    club_id,
    title,
    body,
    priority,
    status,
    show_on_home,
    published_at,
    expires_at,
    created_by,
    updated_by
  ) values (
    target.club_id,
    'Créneau libéré · ' || target.resource_name,
    'Un créneau permanent vient de se libérer le ' || local_slot
      || ' au ' || target.resource_name
      || '. Il est maintenant disponible à la réservation.',
    'normal',
    'published',
    false,
    now(),
    target.starts_at,
    excluded_profile_id,
    excluded_profile_id
  )
  returning id into created_communication_id;

  insert into public.communication_deliveries (
    communication_id,
    club_id,
    club_member_id,
    profile_id_at_publication,
    email_snapshot,
    email_status
  )
  select
    created_communication_id,
    target.club_id,
    member.id,
    profile.id,
    coalesce(nullif(btrim(member.email), ''), nullif(btrim(profile.email), '')),
    case
      when coalesce(nullif(btrim(member.email), ''), nullif(btrim(profile.email), '')) is null
        then 'unavailable'::public.communication_email_status
      else 'not_configured'::public.communication_email_status
    end
  from public.club_members as member
  join public.profiles as profile
    on profile.member_id = member.id
  where member.club_id = target.club_id
    and member.is_active
    and (excluded_profile_id is null or profile.id <> excluded_profile_id)
  on conflict (communication_id, club_member_id) do nothing;

  insert into public.communication_audit_log (
    club_id,
    communication_id,
    action,
    actor_id,
    new_data
  ) values (
    target.club_id,
    created_communication_id,
    'published',
    excluded_profile_id,
    jsonb_build_object(
      'source', 'permanent_slot_released',
      'permanent_slot_id', target.permanent_slot_id,
      'occurrence_id', target.occurrence_id,
      'recipient_count', (
        select count(*)
        from public.communication_deliveries as delivery
        where delivery.communication_id = created_communication_id
      )
    )
  );

  return created_communication_id;
end;
$$;

revoke all on function public.publish_released_permanent_slot_notification(uuid, uuid)
from public, anon, authenticated;

create or replace function public.notify_released_permanent_slot_after_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status
    and new.status = 'released'::public.permanent_slot_occurrence_status
  then
    perform public.publish_released_permanent_slot_notification(
      new.id,
      new.released_by
    );
  end if;

  return new;
end;
$$;

revoke all on function public.notify_released_permanent_slot_after_status_change()
from public, anon, authenticated;

drop trigger if exists permanent_slot_occurrence_notify_release
on public.permanent_slot_occurrences;

create trigger permanent_slot_occurrence_notify_release
after update of status on public.permanent_slot_occurrences
for each row
execute function public.notify_released_permanent_slot_after_status_change();

commit;
