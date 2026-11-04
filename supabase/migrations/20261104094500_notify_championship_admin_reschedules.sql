-- Championship admin rescheduling notices.
-- Covers moved championship reservations and admin updates to manual schedules.
-- Notifications are private: recipients are explicitly assigned before publishing.

create table if not exists public.championship_admin_reschedule_notification_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.championship_matches(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  source_kind text not null check (source_kind in ('reservation', 'manual_schedule')),
  source_id uuid not null,
  new_starts_at timestamptz not null,
  communication_id uuid references public.club_communications(id) on delete set null,
  recipient_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists championship_admin_reschedule_events_match_idx
  on public.championship_admin_reschedule_notification_events(match_id, created_at desc);
alter table public.championship_admin_reschedule_notification_events enable row level security;
revoke all on public.championship_admin_reschedule_notification_events
  from public, anon, authenticated;

create or replace function public.publish_admin_championship_reschedule_notification(
  target_match_id uuid,
  target_club_id uuid,
  target_source_kind text,
  target_source_id uuid,
  target_starts_at timestamptz,
  target_venue text,
  target_resource_id uuid default null,
  target_ends_at timestamptz default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  target_match public.championship_matches%rowtype;
  communication_id uuid;
  event_id uuid;
  recipient_total integer := 0;
  local_timezone text := 'Europe/Paris';
begin
  if target_match_id is null or target_club_id is null or target_starts_at is null
     or target_starts_at <= now() then return; end if;
  select * into target_match from public.championship_matches where id=target_match_id;
  if target_match.id is null then return; end if;

  if target_resource_id is not null then
    select coalesce(timezone, 'Europe/Paris') into local_timezone
    from public.reservable_resources
    where id=target_resource_id and club_id=target_club_id;
    if local_timezone is null then return; end if;
  end if;

  -- Source-specific event allows checking exactly how many recipients were created.
  insert into public.championship_admin_reschedule_notification_events(
    match_id,club_id,source_kind,source_id,new_starts_at
  ) values (
    target_match_id,target_club_id,target_source_kind,target_source_id,target_starts_at
  ) returning id into event_id;

  -- Do not publish a generic club-wide alert when nobody can be identified.
  select count(distinct profile.id) into recipient_total
  from public.profiles profile
  where exists (
    select 1 from public.championship_team_players teammate
    join public.championship_players player on player.id=teammate.player_id
    where teammate.team_id in (target_match.team1_id,target_match.team2_id)
      and player.profile_id=profile.id
      and player.link_status in ('claimed','verified')
  ) or (
    target_resource_id is not null and target_ends_at is not null and exists (
      select 1 from public.referee_slot_assignments a
      where a.club_id=target_club_id and a.resource_id=target_resource_id
        and a.referee_profile_id=profile.id
        and a.starts_at<=target_starts_at and a.ends_at>target_starts_at
    )
  );
  if recipient_total=0 then return; end if;

  insert into public.club_communications(
    club_id,title,body,priority,status,show_on_home,expires_at
  ) values (
    target_club_id,
    'Championnat : partie reprogrammée',
    format(
      'Votre partie de championnat a été reprogrammée le %s à %s%s.',
      to_char(target_starts_at at time zone local_timezone,'DD/MM/YYYY'),
      to_char(target_starts_at at time zone local_timezone,'HH24:MI'),
      case when nullif(btrim(coalesce(target_venue,'')),'') is null
        then '' else ' · ' || btrim(target_venue) end
    ),
    'important','draft',false,target_starts_at + interval '1 day'
  ) returning id into communication_id;

  with recipients as (
    select distinct profile.id as profile_id,
      public.profile_club_member_id(profile.id,target_club_id) as member_id,
      nullif(btrim(profile.email),'') as email_snapshot
    from public.profiles profile
    where exists (
      select 1 from public.championship_team_players teammate
      join public.championship_players player on player.id=teammate.player_id
      where teammate.team_id in (target_match.team1_id,target_match.team2_id)
        and player.profile_id=profile.id
        and player.link_status in ('claimed','verified')
    ) or (
      target_resource_id is not null and target_ends_at is not null and exists (
        select 1 from public.referee_slot_assignments a
        where a.club_id=target_club_id and a.resource_id=target_resource_id
          and a.referee_profile_id=profile.id
          and a.starts_at<=target_starts_at and a.ends_at>target_starts_at
      )
    )
  )
  insert into public.communication_deliveries(
    communication_id,club_id,club_member_id,profile_id_at_publication,
    email_snapshot,email_status
  )
  select communication_id,target_club_id,member_id,profile_id,email_snapshot,
    case when email_snapshot is null
      then 'unavailable'::public.communication_email_status
      else 'not_configured'::public.communication_email_status end
  from recipients
  on conflict do nothing;
  get diagnostics recipient_total = row_count;

  update public.championship_admin_reschedule_notification_events
  set recipient_count=recipient_total,communication_id=communication_id
  where id=event_id;

  if recipient_total>0 then
    update public.club_communications
    set status='published',published_at=now(),updated_at=now()
    where id=communication_id;
  else
    delete from public.club_communications where id=communication_id;
  end if;
end;
$$;
revoke all on function public.publish_admin_championship_reschedule_notification(
  uuid,uuid,text,uuid,timestamptz,text,uuid,timestamptz
) from public, anon, authenticated;

create or replace function public.notify_admin_championship_reservation_changed()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  target_club uuid;
  resource_name text;
begin
  if new.championship_match_id is null
    or new.championship_match_id is distinct from old.championship_match_id
    or new.status <> 'confirmed'
    or old.status <> 'confirmed'
    or (
      new.starts_at is not distinct from old.starts_at
      and new.ends_at is not distinct from old.ends_at
      and new.resource_id is not distinct from old.resource_id
    ) then return new; end if;

  select r.club_id,r.name into target_club,resource_name
  from public.reservable_resources r where r.id=new.resource_id;
  if target_club is null or new.updated_by is null then return new; end if;
  -- A moved reservation is notified only when explicitly changed by a club admin.
  if not public.has_club_permission(target_club,'reservations.manage')
     or not public.has_club_permission(target_club,'championships.manage')
     or auth.uid() is distinct from new.updated_by then return new; end if;

  perform public.publish_admin_championship_reschedule_notification(
    new.championship_match_id,target_club,'reservation',new.id,
    new.starts_at,resource_name,new.resource_id,new.ends_at
  );
  return new;
end;
$$;
revoke all on function public.notify_admin_championship_reservation_changed()
  from public,anon,authenticated;
drop trigger if exists notify_admin_championship_reservation_changed
  on public.reservations;
create trigger notify_admin_championship_reservation_changed
after update of starts_at,ends_at,resource_id on public.reservations
for each row execute function public.notify_admin_championship_reservation_changed();

create or replace function public.notify_admin_championship_manual_schedule_changed()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  target_club uuid;
  match_row public.championship_matches%rowtype;
  local_start timestamptz;
begin
  if new.scheduled_on is not distinct from old.scheduled_on
    and new.scheduled_time is not distinct from old.scheduled_time
    and new.venue is not distinct from old.venue then return new; end if;

  select * into match_row from public.championship_matches where id=new.match_id;
  if match_row.id is null then return new; end if;

  -- A calendar reservation already carries the effective time; let its own
  -- trigger send the one notification during admin swaps.
  if exists (
    select 1 from public.reservations r
    where r.championship_match_id=new.match_id and r.status='confirmed'
  ) then return new; end if;

  select l.club_id into target_club
  from public.championship_divisions d
  join public.championship_club_links l on l.championship_id=d.championship_id
  where d.id=match_row.division_id
    and l.club_id=public.admin_current_club_id()
  limit 1;

  if target_club is null or new.updated_by is distinct from auth.uid()
    or not public.has_club_permission(target_club,'championships.manage')
    then return new; end if;
  local_start:=(new.scheduled_on + new.scheduled_time) at time zone 'Europe/Paris';
  perform public.publish_admin_championship_reschedule_notification(
    new.match_id,target_club,'manual_schedule',new.match_id,
    local_start,new.venue,null,null
  );
  return new;
end;
$$;
revoke all on function public.notify_admin_championship_manual_schedule_changed()
  from public,anon,authenticated;
drop trigger if exists notify_admin_championship_manual_schedule_changed
  on public.championship_match_manual_schedules;
create trigger notify_admin_championship_manual_schedule_changed
after update of scheduled_on,scheduled_time,venue
on public.championship_match_manual_schedules
for each row execute function public.notify_admin_championship_manual_schedule_changed();
