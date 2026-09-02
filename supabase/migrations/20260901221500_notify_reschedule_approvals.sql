begin;

-- PR127 — notifications ciblées pour les équipes qui doivent répondre à une
-- demande de report. Le moteur central club_communications ->
-- communication_deliveries reste l'unique canal de notification / Web Push.

create table if not exists public.tournament_reschedule_notification_events (
  request_id uuid not null references public.tournament_reschedule_requests(id) on delete cascade,
  team_id uuid not null references public.tournament_teams(id) on delete cascade,
  event_kind text not null check (event_kind in ('approval_requested')),
  communication_id uuid not null references public.club_communications(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (request_id, team_id, event_kind),
  unique (communication_id)
);

alter table public.tournament_reschedule_notification_events enable row level security;
revoke all on table public.tournament_reschedule_notification_events
from public, anon, authenticated;

create or replace function public.publish_tournament_reschedule_approval_notification(
  target_request_id uuid,
  target_team_id uuid
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
  requester_label text;
begin
  select
    request.id as request_id,
    request.tournament_id,
    request.requester_team_id,
    request.requested_by,
    request.status as request_status,
    request.expires_at,
    tournament.club_id,
    tournament.name as tournament_name,
    approval.decision
  into target
  from public.tournament_reschedule_requests as request
  join public.tournaments as tournament on tournament.id = request.tournament_id
  join public.tournament_reschedule_approvals as approval
    on approval.request_id = request.id
   and approval.team_id = target_team_id
  where request.id = target_request_id
    and request.status = 'pending'
    and approval.decision = 'pending'
    and approval.team_id <> request.requester_team_id;

  if not found then
    return 0;
  end if;

  if exists (
    select 1
    from public.tournament_reschedule_notification_events as event
    where event.request_id = target.request_id
      and event.team_id = target_team_id
      and event.event_kind = 'approval_requested'
  ) then
    return 0;
  end if;

  requester_label := public.tournament_team_public_label(target.requester_team_id);

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
    concat('Demande de report : ', target.tournament_name),
    concat(
      requester_label,
      ' demande le report d’une partie qui concerne votre équipe. ',
      'Ouvrez « Reports à traiter » pour accepter ou refuser la proposition.'
    ),
    'important',
    'draft',
    false,
    target.expires_at,
    target.requested_by,
    target.requested_by
  )
  returning id into target_communication_id;

  insert into public.tournament_reschedule_notification_events (
    request_id,
    team_id,
    event_kind,
    communication_id
  )
  values (
    target.request_id,
    target_team_id,
    'approval_requested',
    target_communication_id
  )
  on conflict (request_id, team_id, event_kind) do nothing;

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
    target.requested_by,
    jsonb_build_object(
      'source', 'tournament_reschedule',
      'request_id', target.request_id,
      'tournament_id', target.tournament_id,
      'team_id', target_team_id,
      'event_kind', 'approval_requested'
    )
  );

  with recipient_candidates as (
    select distinct
      member.id as club_member_id,
      coalesce(member_profile.id, external_profile.id) as profile_id,
      coalesce(
        nullif(btrim(player.email), ''),
        nullif(btrim(member.email), ''),
        nullif(btrim(member_profile.email), ''),
        nullif(btrim(external_profile.email), '')
      ) as email_snapshot
    from public.tournament_team_players as player
    left join public.club_members as member
      on member.id = player.member_id
     and member.club_id = target.club_id
     and member.is_active
    left join public.profiles as member_profile
      on member_profile.member_id = member.id
    left join lateral (
      select profile.id, profile.email
      from public.profiles as profile
      where member.id is null
        and nullif(btrim(player.email), '') is not null
        and lower(btrim(profile.email)) = lower(btrim(player.email))
      order by profile.id
      limit 1
    ) as external_profile on true
    where player.team_id = target_team_id
      and player.tournament_id = target.tournament_id
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
  where candidate.club_member_id is not null
     or candidate.profile_id is not null
  on conflict do nothing;

  get diagnostics target_recipient_count = row_count;

  if target_recipient_count = 0 then
    delete from public.tournament_reschedule_notification_events
    where request_id = target.request_id
      and team_id = target_team_id
      and event_kind = 'approval_requested';

    delete from public.club_communications
    where id = target_communication_id;

    return 0;
  end if;

  update public.club_communications
  set
    status = 'published',
    published_at = now(),
    updated_at = now(),
    updated_by = target.requested_by
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
    target.requested_by,
    jsonb_build_object(
      'source', 'tournament_reschedule',
      'request_id', target.request_id,
      'tournament_id', target.tournament_id,
      'team_id', target_team_id,
      'event_kind', 'approval_requested',
      'recipient_count', target_recipient_count
    )
  );

  return target_recipient_count;
end;
$$;

revoke all on function public.publish_tournament_reschedule_approval_notification(uuid, uuid)
from public, anon, authenticated;

create or replace function public.notify_tournament_reschedule_approval_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.decision = 'pending' and not new.is_requester then
    perform public.publish_tournament_reschedule_approval_notification(
      new.request_id,
      new.team_id
    );
  end if;
  return new;
end;
$$;

revoke all on function public.notify_tournament_reschedule_approval_after_insert()
from public, anon, authenticated;

drop trigger if exists tournament_reschedule_approvals_notify_after_insert
on public.tournament_reschedule_approvals;

create trigger tournament_reschedule_approvals_notify_after_insert
after insert on public.tournament_reschedule_approvals
for each row
execute function public.notify_tournament_reschedule_approval_after_insert();

create or replace function public.archive_tournament_reschedule_team_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.decision = 'pending' and new.decision <> 'pending' then
    update public.club_communications as communication
    set
      status = 'archived',
      updated_at = now()
    where communication.id in (
      select event.communication_id
      from public.tournament_reschedule_notification_events as event
      where event.request_id = new.request_id
        and event.team_id = new.team_id
        and event.event_kind = 'approval_requested'
    )
      and communication.status = 'published';
  end if;
  return new;
end;
$$;

revoke all on function public.archive_tournament_reschedule_team_notification()
from public, anon, authenticated;

drop trigger if exists tournament_reschedule_approvals_archive_notification
on public.tournament_reschedule_approvals;

create trigger tournament_reschedule_approvals_archive_notification
after update of decision on public.tournament_reschedule_approvals
for each row
execute function public.archive_tournament_reschedule_team_notification();

create or replace function public.archive_tournament_reschedule_request_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'pending' and new.status <> 'pending' then
    update public.club_communications as communication
    set
      status = 'archived',
      updated_at = now()
    where communication.id in (
      select event.communication_id
      from public.tournament_reschedule_notification_events as event
      where event.request_id = new.id
    )
      and communication.status = 'published';
  end if;
  return new;
end;
$$;

revoke all on function public.archive_tournament_reschedule_request_notifications()
from public, anon, authenticated;

drop trigger if exists tournament_reschedule_requests_archive_notifications
on public.tournament_reschedule_requests;

create trigger tournament_reschedule_requests_archive_notifications
after update of status on public.tournament_reschedule_requests
for each row
execute function public.archive_tournament_reschedule_request_notifications();

-- Ajoute un deep-link métier au centre de notifications existant.
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
      when reschedule_event.request_id is not null then '/mon-espace/tournois'
      when admin_event.tournament_id is not null then '/admin/tournois'
      when match_event.match_id is not null then
        format('/mon-espace/tournois?match=%s', match_event.match_id)
      when tournament_event.event_kind = 'planning_published' then '/mon-espace/tournois'
      when tournament_event.tournament_id is not null then
        format('/tournois/%s#inscription', tournament_event.tournament_id)
      else null
    end
  from public.communication_deliveries as deliveries
  join public.club_communications as communications
    on communications.id = deliveries.communication_id
   and communications.club_id = deliveries.club_id
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
    and communications.status in ('published', 'archived')
  order by communications.published_at desc nulls last, communications.id desc;
$$;

revoke all on function public.list_my_notifications_v2()
from public, anon, authenticated;
grant execute on function public.list_my_notifications_v2()
to authenticated;

-- Rattrapage des demandes créées avant l'installation de cette migration.
do $$
declare
  pending record;
begin
  for pending in
    select approval.request_id, approval.team_id
    from public.tournament_reschedule_approvals as approval
    join public.tournament_reschedule_requests as request
      on request.id = approval.request_id
    where request.status = 'pending'
      and approval.decision = 'pending'
      and not approval.is_requester
  loop
    perform public.publish_tournament_reschedule_approval_notification(
      pending.request_id,
      pending.team_id
    );
  end loop;
end;
$$;

commit;
