begin;

create extension if not exists pg_cron;

create table if not exists public.permanent_slot_reminder_events (
  occurrence_id uuid not null references public.permanent_slot_occurrences(id) on delete cascade,
  reminder_kind text not null check (reminder_kind in ('management_open', 'day_before_24h')),
  communication_id uuid not null references public.club_communications(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (occurrence_id, reminder_kind),
  unique (communication_id)
);

alter table public.permanent_slot_reminder_events enable row level security;
revoke all on table public.permanent_slot_reminder_events
from public, anon, authenticated;

create or replace function public.publish_permanent_slot_reminder(
  target_occurrence_id uuid,
  target_reminder_kind text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
  target_communication_id uuid;
  target_recipient_count integer := 0;
  target_management_opens_at timestamptz;
  target_day_before_at timestamptz;
  target_title text;
  target_body text;
begin
  if target_reminder_kind not in ('management_open', 'day_before_24h') then
    return 0;
  end if;

  select
    occurrence.id as occurrence_id,
    occurrence.status,
    slot.id as permanent_slot_id,
    slot.club_id,
    slot.label,
    slot.management_window_hours,
    occupation.starts_at,
    occupation.ends_at,
    resource.name as resource_name
  into target
  from public.permanent_slot_occurrences as occurrence
  join public.permanent_slots as slot
    on slot.id = occurrence.permanent_slot_id
   and slot.is_active
  join public.calendar_occupations as occupation
    on occupation.id = occurrence.occupation_id
   and occupation.cancelled_at is null
  join public.reservable_resources as resource
    on resource.id = slot.resource_id
  where occurrence.id = target_occurrence_id
    and occurrence.status = 'scheduled'::public.permanent_slot_occurrence_status;

  if not found or target.starts_at <= now() then
    return 0;
  end if;

  target_management_opens_at := target.starts_at
    - make_interval(hours => target.management_window_hours);
  target_day_before_at := target.starts_at - interval '24 hours';

  if target_reminder_kind = 'management_open' then
    if now() < target_management_opens_at then
      return 0;
    end if;

    -- Si la fenêtre initiale a été manquée et qu'on est déjà entré dans les
    -- dernières 24 h, on ne double pas les notifications : le rappel 24 h suffit.
    if target.management_window_hours > 24 and now() >= target_day_before_at then
      return 0;
    end if;

    target_title := 'Créneau permanent · action attendue';
    target_body := format(
      'Votre créneau « %s » sur %s est prévu le %s de %s à %s. Vous pouvez le maintenir ou le libérer depuis Mes créneaux permanents.',
      target.label,
      target.resource_name,
      to_char(target.starts_at, 'DD/MM/YYYY'),
      to_char(target.starts_at, 'HH24:MI'),
      to_char(target.ends_at, 'HH24:MI')
    );
  else
    if target.management_window_hours <= 24
      or now() < target_day_before_at
    then
      return 0;
    end if;

    target_title := 'Rappel · créneau permanent dans moins de 24 h';
    target_body := format(
      'Votre créneau « %s » sur %s est prévu le %s de %s à %s. Si vous ne l’utilisez pas, pensez à le libérer.',
      target.label,
      target.resource_name,
      to_char(target.starts_at, 'DD/MM/YYYY'),
      to_char(target.starts_at, 'HH24:MI'),
      to_char(target.ends_at, 'HH24:MI')
    );
  end if;

  if exists (
    select 1
    from public.permanent_slot_reminder_events as event
    where event.occurrence_id = target.occurrence_id
      and event.reminder_kind = target_reminder_kind
  ) then
    return 0;
  end if;

  insert into public.club_communications (
    club_id,
    title,
    body,
    priority,
    status,
    show_on_home,
    expires_at,
    created_by,
    updated_by
  )
  values (
    target.club_id,
    target_title,
    target_body,
    'important',
    'draft',
    false,
    target.starts_at,
    null,
    null
  )
  returning id into target_communication_id;

  insert into public.permanent_slot_reminder_events (
    occurrence_id,
    reminder_kind,
    communication_id
  )
  values (
    target.occurrence_id,
    target_reminder_kind,
    target_communication_id
  )
  on conflict (occurrence_id, reminder_kind) do nothing;

  if not found then
    delete from public.club_communications
    where id = target_communication_id;
    return 0;
  end if;

  insert into public.communication_audit_log (
    club_id,
    communication_id,
    action,
    actor_id,
    new_data
  )
  values (
    target.club_id,
    target_communication_id,
    'created',
    null,
    jsonb_build_object(
      'source', 'permanent_slot_reminder_cron',
      'permanent_slot_id', target.permanent_slot_id,
      'occurrence_id', target.occurrence_id,
      'reminder_kind', target_reminder_kind
    )
  );

  with recipient_candidates as (
    select distinct
      profile.id as profile_id,
      member.id as club_member_id,
      coalesce(
        nullif(btrim(member.email), ''),
        nullif(btrim(profile.email), '')
      ) as email_snapshot
    from public.permanent_slot_managers as manager
    join public.profiles as profile
      on profile.id = manager.profile_id
    left join public.club_members as member
      on member.id = profile.member_id
     and member.club_id = target.club_id
     and member.is_active
    where manager.permanent_slot_id = target.permanent_slot_id
  )
  insert into public.communication_deliveries (
    communication_id,
    club_id,
    club_member_id,
    profile_id_at_publication,
    email_snapshot,
    email_status
  )
  select
    target_communication_id,
    target.club_id,
    candidate.club_member_id,
    candidate.profile_id,
    candidate.email_snapshot,
    case
      when candidate.email_snapshot is null
        then 'unavailable'::public.communication_email_status
      else 'not_configured'::public.communication_email_status
    end
  from recipient_candidates as candidate
  on conflict do nothing;

  get diagnostics target_recipient_count = row_count;

  if target_recipient_count = 0 then
    delete from public.permanent_slot_reminder_events
    where occurrence_id = target.occurrence_id
      and reminder_kind = target_reminder_kind;

    delete from public.club_communications
    where id = target_communication_id;

    return 0;
  end if;

  update public.club_communications
  set status = 'published',
      published_at = now(),
      updated_at = now()
  where id = target_communication_id;

  insert into public.communication_audit_log (
    club_id,
    communication_id,
    action,
    actor_id,
    new_data
  )
  values (
    target.club_id,
    target_communication_id,
    'published',
    null,
    jsonb_build_object(
      'source', 'permanent_slot_reminder_cron',
      'permanent_slot_id', target.permanent_slot_id,
      'occurrence_id', target.occurrence_id,
      'reminder_kind', target_reminder_kind,
      'recipient_count', target_recipient_count
    )
  );

  return target_recipient_count;
end;
$$;

revoke all on function public.publish_permanent_slot_reminder(uuid, text)
from public, anon, authenticated;

create or replace function public.publish_due_permanent_slot_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  due record;
  published_recipients integer := 0;
begin
  for due in
    select occurrence.id as occurrence_id
    from public.permanent_slot_occurrences as occurrence
    join public.permanent_slots as slot
      on slot.id = occurrence.permanent_slot_id
     and slot.is_active
    join public.calendar_occupations as occupation
      on occupation.id = occurrence.occupation_id
     and occupation.cancelled_at is null
    where occurrence.status = 'scheduled'::public.permanent_slot_occurrence_status
      and occupation.starts_at > now()
      and now() >= occupation.starts_at
        - make_interval(hours => slot.management_window_hours)
      and (
        slot.management_window_hours <= 24
        or now() < occupation.starts_at - interval '24 hours'
      )
      and not exists (
        select 1
        from public.permanent_slot_reminder_events as event
        where event.occurrence_id = occurrence.id
          and event.reminder_kind = 'management_open'
      )
  loop
    published_recipients := published_recipients
      + public.publish_permanent_slot_reminder(
          due.occurrence_id,
          'management_open'
        );
  end loop;

  for due in
    select occurrence.id as occurrence_id
    from public.permanent_slot_occurrences as occurrence
    join public.permanent_slots as slot
      on slot.id = occurrence.permanent_slot_id
     and slot.is_active
    join public.calendar_occupations as occupation
      on occupation.id = occurrence.occupation_id
     and occupation.cancelled_at is null
    where occurrence.status = 'scheduled'::public.permanent_slot_occurrence_status
      and slot.management_window_hours > 24
      and occupation.starts_at > now()
      and now() >= occupation.starts_at - interval '24 hours'
      and not exists (
        select 1
        from public.permanent_slot_reminder_events as event
        where event.occurrence_id = occurrence.id
          and event.reminder_kind = 'day_before_24h'
      )
  loop
    published_recipients := published_recipients
      + public.publish_permanent_slot_reminder(
          due.occurrence_id,
          'day_before_24h'
        );
  end loop;

  return published_recipients;
end;
$$;

revoke all on function public.publish_due_permanent_slot_reminders()
from public, anon, authenticated;

create or replace function public.archive_permanent_slot_reminders_after_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  archived record;
begin
  if new.status is distinct from old.status
    and new.status in (
      'confirmed'::public.permanent_slot_occurrence_status,
      'released'::public.permanent_slot_occurrence_status,
      'cancelled'::public.permanent_slot_occurrence_status
    )
  then
    for archived in
      update public.club_communications as communication
      set status = 'archived',
          archived_at = now(),
          updated_at = now()
      from public.permanent_slot_reminder_events as event
      where event.occurrence_id = new.id
        and event.communication_id = communication.id
        and communication.status = 'published'
      returning communication.id, communication.club_id
    loop
      insert into public.communication_audit_log (
        club_id,
        communication_id,
        action,
        actor_id,
        new_data
      )
      values (
        archived.club_id,
        archived.id,
        'archived',
        auth.uid(),
        jsonb_build_object(
          'source', 'permanent_slot_decision',
          'occurrence_id', new.id,
          'new_status', new.status
        )
      );
    end loop;
  end if;

  return new;
end;
$$;

revoke all on function public.archive_permanent_slot_reminders_after_decision()
from public, anon, authenticated;

drop trigger if exists permanent_slot_occurrence_archive_reminders
on public.permanent_slot_occurrences;

create trigger permanent_slot_occurrence_archive_reminders
after update of status on public.permanent_slot_occurrences
for each row
execute function public.archive_permanent_slot_reminders_after_decision();

create or replace function public.list_my_notifications_v2()
returns table (
  delivery_id uuid,
  communication_id uuid,
  title text,
  body text,
  priority public.communication_priority,
  published_at timestamptz,
  expires_at timestamptz,
  read_at timestamptz,
  is_active boolean,
  action_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    deliveries.id,
    communications.id,
    communications.title,
    communications.body,
    communications.priority,
    communications.published_at,
    communications.expires_at,
    deliveries.read_at,
    communications.status = 'published'
      and (communications.expires_at is null or communications.expires_at > now()),
    case
      when payment_request.payment_id is not null then
        format('/reservations/paiement-part?paymentId=%s', payment_request.payment_id)
      when permanent_slot_reminder.occurrence_id is not null then
        '/mon-espace/creneaux-permanents'
      when reschedule_event.request_id is not null then '/mon-espace/tournois'
      when admin_event.tournament_id is not null then '/admin/tournois'
      when match_event.match_id is not null then
        format('/mon-espace/tournois?match=%s', match_event.match_id)
      when tournament_event.event_kind = 'planning_published' then '/mon-espace/tournois'
      when tournament_event.tournament_id is not null then
        format('/tournois/%s#inscription', tournament_event.tournament_id)
      when communications.title like 'Créneau libéré · %' then '/reservations'
      else null
    end
  from public.communication_deliveries as deliveries
  join public.club_communications as communications
    on communications.id = deliveries.communication_id
   and communications.club_id = deliveries.club_id
  left join public.reservation_payment_notification_events as payment_request
    on payment_request.communication_id = communications.id
  left join public.permanent_slot_reminder_events as permanent_slot_reminder
    on permanent_slot_reminder.communication_id = communications.id
  left join public.tournament_notification_events as tournament_event
    on tournament_event.communication_id = communications.id
  left join public.tournament_match_reminder_events as match_event
    on match_event.communication_id = communications.id
  left join public.tournament_admin_reminder_events as admin_event
    on admin_event.communication_id = communications.id
  left join public.tournament_reschedule_notification_events as reschedule_event
    on reschedule_event.communication_id = communications.id
  where (
      deliveries.profile_id_at_publication = auth.uid()
      or exists (
        select 1
        from public.profiles as profile
        join public.club_members as member on member.id = profile.member_id
        where profile.id = auth.uid()
          and member.id = deliveries.club_member_id
          and member.club_id = deliveries.club_id
          and member.is_active
      )
    )
    and deliveries.deleted_at is null
    and communications.status in ('published', 'archived')
  order by communications.published_at desc nulls last, communications.id desc;
$$;

revoke all on function public.list_my_notifications_v2()
from public, anon;
grant execute on function public.list_my_notifications_v2()
to authenticated;

select cron.unschedule(jobid)
from cron.job
where jobname = 'pelote-manager-permanent-slot-reminders';

select cron.schedule(
  'pelote-manager-permanent-slot-reminders',
  '*/15 * * * *',
  $$select public.publish_due_permanent_slot_reminders();$$
);

commit;
