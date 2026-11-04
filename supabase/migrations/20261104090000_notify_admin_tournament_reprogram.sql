-- Notify the two teams (and the referee attached to the new slot) only
-- after an administrator has successfully reprogrammed a tournament match.
-- Use the already-published club communications delivery pipeline.
create table if not exists public.tournament_admin_reprogram_notification_events (
  audit_id uuid primary key references public.tournament_audit_log(id) on delete cascade,
  match_id uuid not null references public.tournament_matches(id) on delete cascade,
  communication_id uuid references public.club_communications(id) on delete set null,
  recipient_count integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.tournament_admin_reprogram_notification_events enable row level security;
revoke all on public.tournament_admin_reprogram_notification_events
  from public, anon, authenticated;

create or replace function public.notify_admin_tournament_match_reprogrammed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_match public.tournament_matches%rowtype;
  target_tournament public.tournaments%rowtype;
  target_resource public.reservable_resources%rowtype;
  target_communication uuid;
  target_date date;
  target_start time;
  target_end time;
  target_start_at timestamptz;
  target_recipient_count integer := 0;
begin
  if new.action <> 'match_reprogrammed' then
    return new;
  end if;

  select * into target_match
  from public.tournament_matches
  where id = nullif(new.payload->>'match_id', '')::uuid
    and tournament_id = new.tournament_id;
  if target_match.id is null then
    return new;
  end if;

  select * into target_tournament from public.tournaments
  where id = new.tournament_id;
  select * into target_resource from public.reservable_resources
  where id = nullif(new.payload->>'resource_id', '')::uuid;
  target_date := nullif(new.payload->>'play_date', '')::date;
  target_start := nullif(new.payload->>'starts_at', '')::time;
  target_end := nullif(new.payload->>'ends_at', '')::time;

  if target_resource.id is null or target_date is null or target_start is null
    or target_end is null or target_tournament.id is null then
    return new;
  end if;

  -- Ignore an audit entry if the match is no longer at the advertised slot.
  if not exists (
    select 1 from public.tournament_match_planning as planning
    where planning.match_id = target_match.id
      and planning.resource_id = target_resource.id
      and planning.play_date = target_date
      and planning.starts_at = target_start
      and planning.ends_at = target_end
  ) then return new; end if;

  target_start_at := public.tournament_planning_starts_at(
    target_date, target_start, target_resource.timezone
  );

  -- One delivery per real profile, even if a player is linked to both teams,
  -- or the referee is also one of the players.
  with recipients as (
    select distinct profile.id as profile_id,
      public.profile_club_member_id(profile.id, target_tournament.club_id) as club_member_id,
      nullif(btrim(profile.email), '') as email_snapshot
    from public.profiles as profile
    where public.tournament_profile_is_linked_to_team(target_match.team_a_id, profile.id)
       or public.tournament_profile_is_linked_to_team(target_match.team_b_id, profile.id)
       or exists (
         select 1 from public.referee_slot_assignments assignment
         where assignment.club_id = target_tournament.club_id
           and assignment.resource_id = target_resource.id
           and assignment.referee_profile_id = profile.id
           and assignment.starts_at <= target_start_at
           and assignment.ends_at > target_start_at
       )
  )
  select count(*) into target_recipient_count from recipients;

  -- Record even zero-recipient events for admin diagnostics, but don't create
  -- a public club message with nobody assigned.
  if target_recipient_count = 0 then
    insert into public.tournament_admin_reprogram_notification_events(
      audit_id,match_id,recipient_count
    ) values (new.id,target_match.id,0)
    on conflict (audit_id) do nothing;
    return new;
  end if;

  insert into public.club_communications(
    club_id,title,body,priority,status,show_on_home,expires_at,
    created_by,updated_by
  ) values (
    target_tournament.club_id,
    'Partie reprogrammée : ' || target_tournament.name,
    format('Votre partie %s contre %s a été reprogrammée le %s à %s sur %s.',
      public.tournament_team_public_label(target_match.team_a_id),
      public.tournament_team_public_label(target_match.team_b_id),
      to_char(target_date,'DD/MM/YYYY'),
      to_char(target_start,'HH24:MI'),
      target_resource.name),
    'important','draft',false,target_start_at + interval '1 day',
    new.created_by,new.created_by
  ) returning id into target_communication;

  with recipients as (
    select distinct profile.id as profile_id,
      public.profile_club_member_id(profile.id, target_tournament.club_id) as club_member_id,
      nullif(btrim(profile.email), '') as email_snapshot
    from public.profiles as profile
    where public.tournament_profile_is_linked_to_team(target_match.team_a_id, profile.id)
       or public.tournament_profile_is_linked_to_team(target_match.team_b_id, profile.id)
       or exists (
         select 1 from public.referee_slot_assignments assignment
         where assignment.club_id = target_tournament.club_id
           and assignment.resource_id = target_resource.id
           and assignment.referee_profile_id = profile.id
           and assignment.starts_at <= target_start_at
           and assignment.ends_at > target_start_at
       )
  )
  insert into public.communication_deliveries(
    communication_id,club_id,club_member_id,profile_id_at_publication,
    email_snapshot,email_status
  )
  select target_communication,target_tournament.club_id,
    club_member_id,profile_id,email_snapshot,
    case when email_snapshot is null
      then 'unavailable'::public.communication_email_status
      else 'not_configured'::public.communication_email_status end
  from recipients
  on conflict do nothing;

  get diagnostics target_recipient_count = row_count;

  -- Publish only after recipients exist so downstream push workers can see them.
  update public.club_communications
  set status = 'published', published_at = now(), updated_at = now()
  where id = target_communication;

  insert into public.tournament_admin_reprogram_notification_events(
    audit_id,match_id,communication_id,recipient_count
  ) values (new.id,target_match.id,target_communication,target_recipient_count)
  on conflict (audit_id) do nothing;

  return new;
end;
$$;

revoke all on function public.notify_admin_tournament_match_reprogrammed()
  from public,anon,authenticated;

drop trigger if exists tournament_admin_reprogram_notify on public.tournament_audit_log;
create trigger tournament_admin_reprogram_notify
after insert on public.tournament_audit_log
for each row
when (new.action = 'match_reprogrammed')
execute function public.notify_admin_tournament_match_reprogrammed();
