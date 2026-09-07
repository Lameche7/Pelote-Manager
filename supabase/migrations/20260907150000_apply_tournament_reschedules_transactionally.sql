begin;

-- PR140 — application transactionnelle des reports de parties.
--
-- Le moteur de suggestion reste en lecture seule. Une demande n'est appliquée
-- qu'après accord de toutes les équipes concernées. L'application synchronise
-- dans une seule transaction le planning tournoi, la grille finale éventuelle,
-- l'événement géré par le tournoi et sa projection dans le calendrier global.

alter table public.tournament_reschedule_requests
  add column if not exists applied_by uuid references public.profiles(id) on delete set null,
  add column if not exists applied_at timestamptz,
  add column if not exists stale_reason text,
  add column if not exists application_snapshot jsonb;

alter table public.tournament_reschedule_approvals
  add column if not exists decision_source text,
  add column if not exists decision_note text;

update public.tournament_reschedule_approvals
set decision_source = 'app'
where decision <> 'pending'
  and decision_source is null;

create or replace function public.normalize_tournament_reschedule_approval_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.decision = 'pending' then
    new.decision_source := null;
    new.decision_note := null;
  elsif new.decision_source is null then
    new.decision_source := 'app';
  end if;

  if new.decision_source = 'app' then
    new.decision_note := null;
  elsif new.decision_source = 'offline_admin' then
    new.decision_note := nullif(btrim(new.decision_note), '');
  end if;

  return new;
end;
$$;

revoke all on function public.normalize_tournament_reschedule_approval_source()
from public, anon, authenticated;

drop trigger if exists tournament_reschedule_approval_source_normalize
on public.tournament_reschedule_approvals;

create trigger tournament_reschedule_approval_source_normalize
before insert or update on public.tournament_reschedule_approvals
for each row
execute function public.normalize_tournament_reschedule_approval_source();

alter table public.tournament_reschedule_approvals
  drop constraint if exists tournament_reschedule_approvals_decision_source_check;
alter table public.tournament_reschedule_approvals
  add constraint tournament_reschedule_approvals_decision_source_check
  check (
    (decision = 'pending' and decision_source is null and decision_note is null)
    or
    (
      decision <> 'pending'
      and decision_source in ('app', 'offline_admin')
      and (
        decision_source <> 'offline_admin'
        or (
          decision_note is not null
          and char_length(btrim(decision_note)) between 3 and 500
        )
      )
    )
  );

-- Un match ne peut participer qu'à une seule demande active, qu'il soit le
-- match demandeur ou le match servant de contrepartie à un échange.
create table if not exists public.tournament_reschedule_active_matches (
  match_id uuid primary key references public.tournament_matches(id) on delete cascade,
  request_id uuid not null references public.tournament_reschedule_requests(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists tournament_reschedule_active_matches_request_idx
on public.tournament_reschedule_active_matches(request_id);

alter table public.tournament_reschedule_active_matches enable row level security;
revoke all on table public.tournament_reschedule_active_matches
from public, anon, authenticated;

insert into public.tournament_reschedule_active_matches(match_id, request_id)
select request.match_id, request.id
from public.tournament_reschedule_requests as request
where request.status in ('pending', 'approved')
union all
select request.swap_match_id, request.id
from public.tournament_reschedule_requests as request
where request.status in ('pending', 'approved')
  and request.swap_match_id is not null
on conflict (match_id) do nothing;

create or replace function public.guard_tournament_reschedule_request_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_plan public.tournament_match_planning%rowtype;
  swap_plan public.tournament_match_planning%rowtype;
  match_snapshot jsonb := coalesce(new.proposal_snapshot->'match', '{}'::jsonb);
  proposal_snapshot jsonb := coalesce(new.proposal_snapshot->'proposal', '{}'::jsonb);
begin
  perform 1
  from public.tournament_matches as match
  where match.id in (new.match_id, new.swap_match_id)
  order by match.id
  for update;

  if exists (
    select 1
    from public.tournament_reschedule_active_matches as active
    where active.match_id in (new.match_id, new.swap_match_id)
  ) then
    raise exception 'Tournament match is already involved in an active reschedule request'
      using errcode = '23505';
  end if;

  select planning.*
  into target_plan
  from public.tournament_match_planning as planning
  where planning.match_id = new.match_id;

  if target_plan.match_id is null
    or target_plan.resource_id is distinct from nullif(match_snapshot->>'resource_id', '')::uuid
    or target_plan.play_date is distinct from nullif(match_snapshot->>'play_date', '')::date
    or target_plan.starts_at is distinct from nullif(match_snapshot->>'starts_at', '')::time
    or target_plan.ends_at is distinct from nullif(match_snapshot->>'ends_at', '')::time then
    raise exception 'Tournament reschedule proposal is no longer available'
      using errcode = 'P0001';
  end if;

  if new.proposal_kind = 'swap' then
    select planning.*
    into swap_plan
    from public.tournament_match_planning as planning
    where planning.match_id = new.swap_match_id;

    if swap_plan.match_id is null
      or swap_plan.resource_id is distinct from nullif(proposal_snapshot->>'resource_id', '')::uuid
      or swap_plan.play_date is distinct from nullif(proposal_snapshot->>'play_date', '')::date
      or swap_plan.starts_at is distinct from nullif(proposal_snapshot->>'starts_at', '')::time
      or swap_plan.ends_at is distinct from nullif(proposal_snapshot->>'ends_at', '')::time then
      raise exception 'Tournament reschedule proposal is no longer available'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_tournament_reschedule_request_snapshot()
from public, anon, authenticated;

drop trigger if exists tournament_reschedule_request_snapshot_guard
on public.tournament_reschedule_requests;

create trigger tournament_reschedule_request_snapshot_guard
before insert on public.tournament_reschedule_requests
for each row
execute function public.guard_tournament_reschedule_request_snapshot();

create or replace function public.sync_tournament_reschedule_active_matches()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.tournament_reschedule_active_matches
    where request_id = old.id;
    return old;
  end if;

  delete from public.tournament_reschedule_active_matches
  where request_id = new.id;

  if new.status in ('pending', 'approved') then
    insert into public.tournament_reschedule_active_matches(match_id, request_id)
    values (new.match_id, new.id);

    if new.swap_match_id is not null then
      insert into public.tournament_reschedule_active_matches(match_id, request_id)
      values (new.swap_match_id, new.id);
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_tournament_reschedule_active_matches()
from public, anon, authenticated;

drop trigger if exists tournament_reschedule_requests_sync_active_matches
on public.tournament_reschedule_requests;

create trigger tournament_reschedule_requests_sync_active_matches
after insert or update or delete on public.tournament_reschedule_requests
for each row
execute function public.sync_tournament_reschedule_active_matches();

-- La grille complète des phases finales réserve aussi des créneaux futurs qui
-- ne sont pas encore matérialisés comme matchs. Ils ne doivent pas apparaître
-- comme de faux créneaux libres dans le moteur de report.
alter function public.get_my_tournament_reschedule_options(uuid, uuid)
  rename to get_my_tournament_reschedule_options_before_final_grid_guard;

revoke all on function public.get_my_tournament_reschedule_options_before_final_grid_guard(uuid, uuid)
from public, anon, authenticated;

create or replace function public.get_my_tournament_reschedule_options(
  target_match_id uuid,
  requester_team_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  target_match public.tournament_matches%rowtype;
begin
  result := public.get_my_tournament_reschedule_options_before_final_grid_guard(
    target_match_id,
    requester_team_id
  );

  select match.*
  into target_match
  from public.tournament_matches as match
  where match.id = target_match_id;

  if target_match.phase = 'finals' then
    result := jsonb_set(
      result,
      '{free_slots}',
      coalesce((
        select jsonb_agg(item.value order by item.ordinality)
        from jsonb_array_elements(coalesce(result->'free_slots', '[]'::jsonb))
          with ordinality as item(value, ordinality)
        where not exists (
          select 1
          from public.tournament_final_planning_nodes as node
          where node.tournament_id = target_match.tournament_id
            and node.resource_id = nullif(item.value->>'resource_id', '')::uuid
            and node.play_date = nullif(item.value->>'play_date', '')::date
            and node.starts_at = nullif(item.value->>'starts_at', '')::time
            and not (
              node.series_id = target_match.series_id
              and node.round_number = target_match.final_round_number
              and node.display_order = target_match.display_order
            )
        )
      ), '[]'::jsonb),
      true
    );
  end if;

  return result;
end;
$$;

revoke all on function public.get_my_tournament_reschedule_options(uuid, uuid)
from public, anon;
grant execute on function public.get_my_tournament_reschedule_options(uuid, uuid)
to authenticated;

create or replace function public.mark_tournament_reschedule_stale(
  target_request_id uuid,
  target_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_request public.tournament_reschedule_requests%rowtype;
begin
  select request.*
  into target_request
  from public.tournament_reschedule_requests as request
  where request.id = target_request_id
  for update;

  if target_request.id is null
    or target_request.status not in ('pending', 'approved') then
    return;
  end if;

  update public.tournament_reschedule_requests
  set
    status = 'stale',
    stale_reason = nullif(btrim(target_reason), ''),
    updated_at = now()
  where id = target_request.id;

  insert into public.tournament_audit_log(
    tournament_id, action, payload, created_by
  ) values (
    target_request.tournament_id,
    'reschedule_stale',
    jsonb_build_object(
      'request_id', target_request.id,
      'reason', nullif(btrim(target_reason), '')
    ),
    auth.uid()
  );
end;
$$;

revoke all on function public.mark_tournament_reschedule_stale(uuid, text)
from public, anon, authenticated;

-- Une équipe sans compte relié peut répondre hors application. L'admin ne
-- force pas une décision : il enregistre explicitement la réponse recueillie et
-- une note de contact obligatoire, le tout dans l'audit tournoi.
create or replace function public.admin_record_tournament_reschedule_offline_decision(
  target_request_id uuid,
  target_team_id uuid,
  target_decision text,
  contact_note text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_request public.tournament_reschedule_requests%rowtype;
  target_approval public.tournament_reschedule_approvals%rowtype;
  next_status text;
  cleaned_note text := nullif(btrim(contact_note), '');
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if target_decision not in ('approved', 'rejected') then
    raise exception 'Tournament reschedule decision is invalid' using errcode = '22023';
  end if;

  if cleaned_note is null or char_length(cleaned_note) not between 3 and 500 then
    raise exception 'Tournament reschedule offline contact note is required'
      using errcode = '22023';
  end if;

  select request.*
  into target_request
  from public.tournament_reschedule_requests as request
  join public.tournaments as tournament on tournament.id = request.tournament_id
  where request.id = target_request_id
    and tournament.club_id = target_club_id
  for update of request;

  if target_request.id is null then
    raise exception 'Tournament reschedule request not found' using errcode = 'P0002';
  end if;

  if target_request.status <> 'pending' then
    raise exception 'Tournament reschedule request is no longer pending' using errcode = 'P0001';
  end if;

  if target_request.expires_at <= now() then
    perform public.mark_tournament_reschedule_stale(target_request.id, 'request_expired');
    return 'stale';
  end if;

  select approval.*
  into target_approval
  from public.tournament_reschedule_approvals as approval
  where approval.request_id = target_request.id
    and approval.team_id = target_team_id
  for update;

  if target_approval.request_id is null or target_approval.decision <> 'pending' then
    raise exception 'Tournament reschedule approval is not pending' using errcode = 'P0001';
  end if;

  if public.tournament_team_app_actor_count(target_team_id) > 0 then
    raise exception 'Tournament reschedule team can answer in the application'
      using errcode = 'P0001';
  end if;

  update public.tournament_reschedule_approvals
  set
    decision = target_decision,
    decision_source = 'offline_admin',
    decision_note = cleaned_note,
    decided_by = auth.uid(),
    decided_at = now()
  where request_id = target_request.id
    and team_id = target_team_id;

  if target_decision = 'rejected' then
    next_status := 'rejected';
  elsif not exists (
    select 1
    from public.tournament_reschedule_approvals as approval
    where approval.request_id = target_request.id
      and approval.decision = 'pending'
  ) then
    next_status := 'approved';
  else
    next_status := 'pending';
  end if;

  update public.tournament_reschedule_requests
  set status = next_status, updated_at = now()
  where id = target_request.id;

  insert into public.tournament_audit_log(
    tournament_id, action, payload, created_by
  ) values (
    target_request.tournament_id,
    case when target_decision = 'approved'
      then 'reschedule_team_approved_offline'
      else 'reschedule_team_rejected_offline'
    end,
    jsonb_build_object(
      'request_id', target_request.id,
      'team_id', target_team_id,
      'request_status', next_status,
      'contact_note', cleaned_note
    ),
    auth.uid()
  );

  return next_status;
end;
$$;

revoke all on function public.admin_record_tournament_reschedule_offline_decision(uuid, uuid, text, text)
from public, anon;
grant execute on function public.admin_record_tournament_reschedule_offline_decision(uuid, uuid, text, text)
to authenticated;

-- Les notifications d'application réutilisent le canal central déjà créé par
-- PR127. Le même lien profond /mon-espace/tournois continue donc de fonctionner.
alter table public.tournament_reschedule_notification_events
  drop constraint if exists tournament_reschedule_notification_events_event_kind_check;
alter table public.tournament_reschedule_notification_events
  add constraint tournament_reschedule_notification_events_event_kind_check
  check (event_kind in ('approval_requested', 'applied'));

create or replace function public.publish_tournament_reschedule_applied_team_notification(
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
  target_resource_name text;
  target_resource_timezone text;
  target_play_date date;
  target_starts_at time;
  target_ends_at time;
  target_resource_id uuid;
  target_actor uuid;
begin
  select
    request.id as request_id,
    request.tournament_id,
    request.proposal_kind,
    request.swap_match_id,
    request.target_resource_id,
    request.target_play_date,
    request.target_starts_at,
    request.target_ends_at,
    request.swap_return_resource_id,
    request.swap_return_play_date,
    request.swap_return_starts_at,
    request.swap_return_ends_at,
    request.applied_by,
    request.requested_by,
    tournament.club_id,
    tournament.name as tournament_name,
    swap_match.team_a_id as swap_team_a_id,
    swap_match.team_b_id as swap_team_b_id
  into target
  from public.tournament_reschedule_requests as request
  join public.tournaments as tournament on tournament.id = request.tournament_id
  left join public.tournament_matches as swap_match on swap_match.id = request.swap_match_id
  where request.id = target_request_id
    and request.status = 'applied';

  if not found then
    return 0;
  end if;

  if exists (
    select 1
    from public.tournament_reschedule_notification_events as event
    where event.request_id = target.request_id
      and event.team_id = target_team_id
      and event.event_kind = 'applied'
  ) then
    return 0;
  end if;

  if target.proposal_kind = 'swap'
    and target_team_id in (target.swap_team_a_id, target.swap_team_b_id) then
    target_resource_id := target.swap_return_resource_id;
    target_play_date := target.swap_return_play_date;
    target_starts_at := target.swap_return_starts_at;
    target_ends_at := target.swap_return_ends_at;
  else
    target_resource_id := target.target_resource_id;
    target_play_date := target.target_play_date;
    target_starts_at := target.target_starts_at;
    target_ends_at := target.target_ends_at;
  end if;

  select resource.name, resource.timezone
  into target_resource_name, target_resource_timezone
  from public.reservable_resources as resource
  where resource.id = target_resource_id;

  if target_resource_name is null then
    return 0;
  end if;

  target_actor := coalesce(target.applied_by, target.requested_by);

  insert into public.club_communications(
    club_id, title, body, priority, status, show_on_home,
    expires_at, created_by, updated_by
  ) values (
    target.club_id,
    concat('Report appliqué : ', target.tournament_name),
    concat(
      'La nouvelle programmation de votre équipe est confirmée : ',
      to_char(target_play_date, 'DD/MM/YYYY'),
      ' à ', to_char(target_starts_at, 'HH24:MI'),
      ' sur ', target_resource_name, '.'
    ),
    'important',
    'draft',
    false,
    public.tournament_planning_starts_at(
      target_play_date,
      target_starts_at,
      target_resource_timezone
    ) + interval '1 day',
    target_actor,
    target_actor
  )
  returning id into target_communication_id;

  insert into public.tournament_reschedule_notification_events(
    request_id, team_id, event_kind, communication_id
  ) values (
    target.request_id, target_team_id, 'applied', target_communication_id
  )
  on conflict (request_id, team_id, event_kind) do nothing;

  if not found then
    delete from public.club_communications where id = target_communication_id;
    return 0;
  end if;

  insert into public.communication_audit_log(
    club_id, communication_id, action, actor_id, new_data
  ) values (
    target.club_id,
    target_communication_id,
    'created',
    target_actor,
    jsonb_build_object(
      'source', 'tournament_reschedule',
      'request_id', target.request_id,
      'tournament_id', target.tournament_id,
      'team_id', target_team_id,
      'event_kind', 'applied'
    )
  );

  with recipients as (
    select distinct
      member.id as club_member_id,
      profile.id as profile_id,
      nullif(btrim(profile.email), '') as email_snapshot
    from public.profiles as profile
    left join public.club_members as member
      on member.id = profile.member_id
     and member.club_id = target.club_id
     and member.is_active
    where public.tournament_profile_is_linked_to_team(target_team_id, profile.id)
  )
  insert into public.communication_deliveries(
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
    recipient.club_member_id,
    recipient.profile_id,
    recipient.email_snapshot,
    case
      when recipient.email_snapshot is null
        then 'unavailable'::public.communication_email_status
      else 'not_configured'::public.communication_email_status
    end
  from recipients as recipient
  on conflict do nothing;

  get diagnostics target_recipient_count = row_count;

  if target_recipient_count = 0 then
    delete from public.tournament_reschedule_notification_events
    where request_id = target.request_id
      and team_id = target_team_id
      and event_kind = 'applied';
    delete from public.club_communications where id = target_communication_id;
    return 0;
  end if;

  update public.club_communications
  set
    status = 'published',
    published_at = now(),
    updated_at = now(),
    updated_by = target_actor
  where id = target_communication_id;

  insert into public.communication_audit_log(
    club_id, communication_id, action, actor_id, new_data
  ) values (
    target.club_id,
    target_communication_id,
    'published',
    target_actor,
    jsonb_build_object(
      'source', 'tournament_reschedule',
      'request_id', target.request_id,
      'tournament_id', target.tournament_id,
      'team_id', target_team_id,
      'event_kind', 'applied',
      'recipient_count', target_recipient_count
    )
  );

  return target_recipient_count;
end;
$$;

revoke all on function public.publish_tournament_reschedule_applied_team_notification(uuid, uuid)
from public, anon, authenticated;

create or replace function public.notify_tournament_reschedule_after_application()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_team_id uuid;
begin
  if old.status <> 'applied' and new.status = 'applied' then
    for target_team_id in
      select approval.team_id
      from public.tournament_reschedule_approvals as approval
      where approval.request_id = new.id
      order by approval.team_id
    loop
      begin
        perform public.publish_tournament_reschedule_applied_team_notification(
          new.id,
          target_team_id
        );
      exception when others then
        -- Une panne du canal de notification ne doit jamais annuler un report
        -- déjà validé et synchronisé dans le planning.
        null;
      end;
    end loop;
  end if;
  return new;
end;
$$;

revoke all on function public.notify_tournament_reschedule_after_application()
from public, anon, authenticated;

drop trigger if exists tournament_reschedule_requests_notify_after_application
on public.tournament_reschedule_requests;

create trigger tournament_reschedule_requests_notify_after_application
after update of status on public.tournament_reschedule_requests
for each row
execute function public.notify_tournament_reschedule_after_application();

-- Synchronise un événement de match déjà publié vers une nouvelle affectation.
create or replace function public.sync_tournament_reschedule_match_event(
  target_match_id uuid,
  target_resource_id uuid,
  target_play_date date,
  target_starts_at time,
  target_ends_at time
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event_id uuid;
  target_timezone text;
  previous_event public.events%rowtype;
  saved_event public.events%rowtype;
begin
  select link.event_id
  into target_event_id
  from public.tournament_match_events as link
  join public.events as event on event.id = link.event_id
  where link.match_id = target_match_id
    and event.publication_status = 'published'
  for update of event;

  if target_event_id is null then
    raise exception 'Tournament match is not published' using errcode = 'P0001';
  end if;

  select resource.timezone
  into target_timezone
  from public.reservable_resources as resource
  where resource.id = target_resource_id;

  if target_timezone is null then
    raise exception 'Tournament match resource is invalid' using errcode = 'P0001';
  end if;

  select event.*
  into previous_event
  from public.events as event
  where event.id = target_event_id
  for update;

  perform set_config('app.allow_tournament_event_sync', 'on', true);

  update public.events
  set
    starts_at = public.tournament_planning_starts_at(
      target_play_date, target_starts_at, target_timezone
    ),
    ends_at = public.tournament_planning_starts_at(
      target_play_date, target_ends_at, target_timezone
    ),
    updated_by = auth.uid(),
    updated_at = now()
  where id = target_event_id
  returning * into saved_event;

  delete from public.event_resources
  where event_id = target_event_id;

  insert into public.event_resources(event_id, resource_id)
  values (target_event_id, target_resource_id);

  perform public.sync_event_occupations(target_event_id);

  insert into public.event_audit_log(
    club_id, event_id, action, actor_id, previous_data, new_data
  ) values (
    saved_event.club_id,
    target_event_id,
    'updated',
    auth.uid(),
    to_jsonb(previous_event),
    to_jsonb(saved_event)
      || jsonb_build_object('resource_ids', jsonb_build_array(target_resource_id))
  );
end;
$$;

revoke all on function public.sync_tournament_reschedule_match_event(uuid, uuid, date, time, time)
from public, anon, authenticated;

create or replace function public.admin_apply_tournament_reschedule_request(
  target_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  request public.tournament_reschedule_requests%rowtype;
  tournament public.tournaments%rowtype;
  target_match public.tournament_matches%rowtype;
  swap_match public.tournament_matches%rowtype;
  target_plan public.tournament_match_planning%rowtype;
  swap_plan public.tournament_match_planning%rowtype;
  target_resource public.reservable_resources%rowtype;
  return_resource public.reservable_resources%rowtype;
  match_snapshot jsonb;
  proposal_snapshot jsonb;
  opponent_team_id uuid;
  swap_team_a_id uuid;
  swap_team_b_id uuid;
  target_event_id uuid;
  swap_event_id uuid;
  opponent_original_other integer;
  opponent_target_other integer;
  swap_a_original_other integer;
  swap_a_target_other integer;
  swap_b_original_other integer;
  swap_b_target_other integer;
  before_snapshot jsonb;
  after_snapshot jsonb;
  target_node_exists boolean := false;
  swap_node_exists boolean := false;
  mutation_conflict boolean := false;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select item.*
  into request
  from public.tournament_reschedule_requests as item
  where item.id = target_request_id
  for update;

  if request.id is null then
    raise exception 'Tournament reschedule request not found' using errcode = 'P0002';
  end if;

  select item.*
  into tournament
  from public.tournaments as item
  where item.id = request.tournament_id
    and item.club_id = target_club_id
  for update;

  if tournament.id is null then
    raise exception 'Tournament reschedule request is outside this club'
      using errcode = '42501';
  end if;

  if request.status <> 'approved' then
    raise exception 'Tournament reschedule request is not ready to apply'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.tournament_reschedule_approvals as approval
    where approval.request_id = request.id
      and approval.decision <> 'approved'
  ) then
    raise exception 'Tournament reschedule request still misses an approval'
      using errcode = 'P0001';
  end if;

  if request.expires_at <= now() then
    perform public.mark_tournament_reschedule_stale(request.id, 'request_expired');
    return jsonb_build_object('status', 'stale', 'reason', 'request_expired');
  end if;

  if tournament.status not in ('planning_published', 'in_progress') then
    perform public.mark_tournament_reschedule_stale(request.id, 'tournament_stage_changed');
    return jsonb_build_object('status', 'stale', 'reason', 'tournament_stage_changed');
  end if;

  perform 1
  from public.tournament_matches as match
  where match.id in (request.match_id, request.swap_match_id)
  order by match.id
  for update;

  if exists (
    select 1
    from public.tournament_reschedule_active_matches as active
    where active.match_id in (request.match_id, request.swap_match_id)
      and active.request_id <> request.id
  ) then
    perform public.mark_tournament_reschedule_stale(request.id, 'another_reschedule_started');
    return jsonb_build_object('status', 'stale', 'reason', 'another_reschedule_started');
  end if;

  select match.*
  into target_match
  from public.tournament_matches as match
  where match.id = request.match_id
    and match.tournament_id = request.tournament_id;

  if target_match.id is null
    or request.requester_team_id not in (target_match.team_a_id, target_match.team_b_id) then
    perform public.mark_tournament_reschedule_stale(request.id, 'match_changed');
    return jsonb_build_object('status', 'stale', 'reason', 'match_changed');
  end if;

  opponent_team_id := case
    when target_match.team_a_id = request.requester_team_id then target_match.team_b_id
    else target_match.team_a_id
  end;

  if exists (
    select 1 from public.tournament_match_results as result
    where result.match_id = target_match.id
  ) then
    perform public.mark_tournament_reschedule_stale(request.id, 'match_has_result');
    return jsonb_build_object('status', 'stale', 'reason', 'match_has_result');
  end if;

  select planning.*
  into target_plan
  from public.tournament_match_planning as planning
  where planning.match_id = target_match.id
  for update;

  match_snapshot := coalesce(request.proposal_snapshot->'match', '{}'::jsonb);
  proposal_snapshot := coalesce(request.proposal_snapshot->'proposal', '{}'::jsonb);

  if target_plan.match_id is null
    or target_plan.resource_id is distinct from nullif(match_snapshot->>'resource_id', '')::uuid
    or target_plan.play_date is distinct from nullif(match_snapshot->>'play_date', '')::date
    or target_plan.starts_at is distinct from nullif(match_snapshot->>'starts_at', '')::time
    or target_plan.ends_at is distinct from nullif(match_snapshot->>'ends_at', '')::time then
    perform public.mark_tournament_reschedule_stale(request.id, 'source_planning_changed');
    return jsonb_build_object('status', 'stale', 'reason', 'source_planning_changed');
  end if;

  if request.proposal_kind = 'swap' then
    select match.*
    into swap_match
    from public.tournament_matches as match
    where match.id = request.swap_match_id
      and match.tournament_id = request.tournament_id
      and match.phase = target_match.phase;

    if swap_match.id is null then
      perform public.mark_tournament_reschedule_stale(request.id, 'swap_match_changed');
      return jsonb_build_object('status', 'stale', 'reason', 'swap_match_changed');
    end if;

    swap_team_a_id := swap_match.team_a_id;
    swap_team_b_id := swap_match.team_b_id;

    if exists (
      select 1 from public.tournament_match_results as result
      where result.match_id = swap_match.id
    ) then
      perform public.mark_tournament_reschedule_stale(request.id, 'swap_match_has_result');
      return jsonb_build_object('status', 'stale', 'reason', 'swap_match_has_result');
    end if;

    select planning.*
    into swap_plan
    from public.tournament_match_planning as planning
    where planning.match_id = swap_match.id
    for update;

    if swap_plan.match_id is null
      or swap_plan.resource_id is distinct from nullif(proposal_snapshot->>'resource_id', '')::uuid
      or swap_plan.play_date is distinct from nullif(proposal_snapshot->>'play_date', '')::date
      or swap_plan.starts_at is distinct from nullif(proposal_snapshot->>'starts_at', '')::time
      or swap_plan.ends_at is distinct from nullif(proposal_snapshot->>'ends_at', '')::time
      or request.swap_return_resource_id is distinct from target_plan.resource_id
      or request.swap_return_play_date is distinct from target_plan.play_date
      or request.swap_return_starts_at is distinct from target_plan.starts_at
      or request.swap_return_ends_at is distinct from target_plan.ends_at then
      perform public.mark_tournament_reschedule_stale(request.id, 'swap_planning_changed');
      return jsonb_build_object('status', 'stale', 'reason', 'swap_planning_changed');
    end if;
  end if;

  select link.event_id
  into target_event_id
  from public.tournament_match_events as link
  join public.events as event on event.id = link.event_id
  where link.match_id = target_match.id
    and event.publication_status = 'published';

  if target_event_id is null then
    perform public.mark_tournament_reschedule_stale(request.id, 'match_unpublished');
    return jsonb_build_object('status', 'stale', 'reason', 'match_unpublished');
  end if;

  if request.proposal_kind = 'swap' then
    select link.event_id
    into swap_event_id
    from public.tournament_match_events as link
    join public.events as event on event.id = link.event_id
    where link.match_id = swap_match.id
      and event.publication_status = 'published';

    if swap_event_id is null then
      perform public.mark_tournament_reschedule_stale(request.id, 'swap_match_unpublished');
      return jsonb_build_object('status', 'stale', 'reason', 'swap_match_unpublished');
    end if;
  end if;

  perform 1
  from public.reservable_resources as resource
  where resource.id in (
    target_plan.resource_id,
    request.target_resource_id,
    request.swap_return_resource_id
  )
  order by resource.id
  for update;

  select resource.*
  into target_resource
  from public.reservable_resources as resource
  where resource.id = request.target_resource_id
    and resource.is_active
    and exists (
      select 1 from public.tournament_resources as selected
      where selected.tournament_id = request.tournament_id
        and selected.resource_id = resource.id
    );

  if target_resource.id is null
    or not exists (
      select 1
      from public.tournament_generated_slots(request.tournament_id) as slot
      where slot.phase = target_match.phase
        and slot.play_date = request.target_play_date
        and slot.starts_at = request.target_starts_at
        and slot.ends_at = request.target_ends_at
    ) then
    perform public.mark_tournament_reschedule_stale(request.id, 'target_slot_invalid');
    return jsonb_build_object('status', 'stale', 'reason', 'target_slot_invalid');
  end if;

  if public.tournament_planning_starts_at(
    request.target_play_date,
    request.target_starts_at,
    target_resource.timezone
  ) <= now() then
    perform public.mark_tournament_reschedule_stale(request.id, 'target_slot_started');
    return jsonb_build_object('status', 'stale', 'reason', 'target_slot_started');
  end if;

  if request.proposal_kind = 'swap' then
    select resource.*
    into return_resource
    from public.reservable_resources as resource
    where resource.id = request.swap_return_resource_id
      and resource.is_active
      and exists (
        select 1 from public.tournament_resources as selected
        where selected.tournament_id = request.tournament_id
          and selected.resource_id = resource.id
      );

    if return_resource.id is null then
      perform public.mark_tournament_reschedule_stale(request.id, 'swap_return_slot_invalid');
      return jsonb_build_object('status', 'stale', 'reason', 'swap_return_slot_invalid');
    end if;
  end if;

  -- Aucun terrain ne peut accueillir deux rencontres qui se chevauchent, même
  -- si l'autre rencontre n'est pas encore publiée dans le calendrier global.
  if exists (
    select 1
    from public.tournament_match_planning as planning
    where planning.tournament_id = request.tournament_id
      and planning.match_id <> request.match_id
      and (request.swap_match_id is null or planning.match_id <> request.swap_match_id)
      and planning.resource_id = request.target_resource_id
      and planning.play_date = request.target_play_date
      and planning.starts_at < request.target_ends_at
      and planning.ends_at > request.target_starts_at
  ) then
    perform public.mark_tournament_reschedule_stale(request.id, 'target_slot_conflict');
    return jsonb_build_object('status', 'stale', 'reason', 'target_slot_conflict');
  end if;

  if request.proposal_kind = 'swap' and exists (
    select 1
    from public.tournament_match_planning as planning
    where planning.tournament_id = request.tournament_id
      and planning.match_id not in (request.match_id, request.swap_match_id)
      and planning.resource_id = request.swap_return_resource_id
      and planning.play_date = request.swap_return_play_date
      and planning.starts_at < request.swap_return_ends_at
      and planning.ends_at > request.swap_return_starts_at
  ) then
    perform public.mark_tournament_reschedule_stale(request.id, 'swap_return_slot_conflict');
    return jsonb_build_object('status', 'stale', 'reason', 'swap_return_slot_conflict');
  end if;

  if exists (
    select 1
    from public.calendar_occupations as occupation
    where occupation.resource_id = request.target_resource_id
      and occupation.cancelled_at is null
      and occupation.starts_at < public.tournament_planning_starts_at(
        request.target_play_date, request.target_ends_at, target_resource.timezone
      )
      and occupation.ends_at > public.tournament_planning_starts_at(
        request.target_play_date, request.target_starts_at, target_resource.timezone
      )
      and occupation.id not in (
        select event_resource.calendar_occupation_id
        from public.tournament_match_events as link
        join public.event_resources as event_resource on event_resource.event_id = link.event_id
        where link.match_id in (request.match_id, request.swap_match_id)
          and event_resource.calendar_occupation_id is not null
      )
  ) then
    perform public.mark_tournament_reschedule_stale(request.id, 'calendar_conflict');
    return jsonb_build_object('status', 'stale', 'reason', 'calendar_conflict');
  end if;

  if request.proposal_kind = 'swap' and exists (
    select 1
    from public.calendar_occupations as occupation
    where occupation.resource_id = request.swap_return_resource_id
      and occupation.cancelled_at is null
      and occupation.starts_at < public.tournament_planning_starts_at(
        request.swap_return_play_date, request.swap_return_ends_at, return_resource.timezone
      )
      and occupation.ends_at > public.tournament_planning_starts_at(
        request.swap_return_play_date, request.swap_return_starts_at, return_resource.timezone
      )
      and occupation.id not in (
        select event_resource.calendar_occupation_id
        from public.tournament_match_events as link
        join public.event_resources as event_resource on event_resource.event_id = link.event_id
        where link.match_id in (request.match_id, request.swap_match_id)
          and event_resource.calendar_occupation_id is not null
      )
  ) then
    perform public.mark_tournament_reschedule_stale(request.id, 'calendar_conflict');
    return jsonb_build_object('status', 'stale', 'reason', 'calendar_conflict');
  end if;

  -- Les quatre équipes éventuellement concernées ne peuvent jamais avoir deux
  -- matchs qui se chevauchent. Le demandeur peut seulement accepter une charge
  -- plus forte sur la journée, pas deux matchs simultanés.
  if exists (
    select 1
    from public.tournament_matches as other_match
    join public.tournament_match_planning as planning on planning.match_id = other_match.id
    where other_match.tournament_id = request.tournament_id
      and other_match.id <> request.match_id
      and (request.swap_match_id is null or other_match.id <> request.swap_match_id)
      and (
        request.requester_team_id in (other_match.team_a_id, other_match.team_b_id)
        or opponent_team_id in (other_match.team_a_id, other_match.team_b_id)
      )
      and planning.play_date = request.target_play_date
      and planning.starts_at < request.target_ends_at
      and planning.ends_at > request.target_starts_at
  ) then
    perform public.mark_tournament_reschedule_stale(request.id, 'team_overlap');
    return jsonb_build_object('status', 'stale', 'reason', 'team_overlap');
  end if;

  if request.proposal_kind = 'swap' and exists (
    select 1
    from public.tournament_matches as other_match
    join public.tournament_match_planning as planning on planning.match_id = other_match.id
    where other_match.tournament_id = request.tournament_id
      and other_match.id not in (request.match_id, request.swap_match_id)
      and (
        swap_team_a_id in (other_match.team_a_id, other_match.team_b_id)
        or swap_team_b_id in (other_match.team_a_id, other_match.team_b_id)
      )
      and planning.play_date = request.swap_return_play_date
      and planning.starts_at < request.swap_return_ends_at
      and planning.ends_at > request.swap_return_starts_at
  ) then
    perform public.mark_tournament_reschedule_stale(request.id, 'team_overlap');
    return jsonb_build_object('status', 'stale', 'reason', 'team_overlap');
  end if;

  -- La charge quotidienne des équipes qui subissent la demande ne doit pas
  -- augmenter. Aucun temps de repos minimum n'est introduit ici.
  select count(*)::integer into opponent_original_other
  from public.tournament_matches as match
  join public.tournament_match_planning as planning on planning.match_id = match.id
  where match.tournament_id = request.tournament_id
    and match.id <> request.match_id
    and (request.swap_match_id is null or match.id <> request.swap_match_id)
    and opponent_team_id in (match.team_a_id, match.team_b_id)
    and planning.play_date = target_plan.play_date;

  select count(*)::integer into opponent_target_other
  from public.tournament_matches as match
  join public.tournament_match_planning as planning on planning.match_id = match.id
  where match.tournament_id = request.tournament_id
    and match.id <> request.match_id
    and (request.swap_match_id is null or match.id <> request.swap_match_id)
    and opponent_team_id in (match.team_a_id, match.team_b_id)
    and planning.play_date = request.target_play_date;

  if opponent_target_other > opponent_original_other then
    perform public.mark_tournament_reschedule_stale(request.id, 'other_team_daily_load_increased');
    return jsonb_build_object('status', 'stale', 'reason', 'other_team_daily_load_increased');
  end if;

  if exists (
    select 1 from public.tournament_team_availability_slots as availability
    where availability.team_id = opponent_team_id
  ) and not exists (
    select 1 from public.tournament_team_availability_slots as availability
    where availability.team_id = opponent_team_id
      and availability.play_date = request.target_play_date
      and availability.starts_at = request.target_starts_at
      and availability.ends_at = request.target_ends_at
  ) then
    perform public.mark_tournament_reschedule_stale(request.id, 'affected_team_unavailable');
    return jsonb_build_object('status', 'stale', 'reason', 'affected_team_unavailable');
  end if;

  if request.proposal_kind = 'swap' then
    select count(*)::integer into swap_a_original_other
    from public.tournament_matches as match
    join public.tournament_match_planning as planning on planning.match_id = match.id
    where match.tournament_id = request.tournament_id
      and match.id not in (request.match_id, request.swap_match_id)
      and swap_team_a_id in (match.team_a_id, match.team_b_id)
      and planning.play_date = swap_plan.play_date;

    select count(*)::integer into swap_a_target_other
    from public.tournament_matches as match
    join public.tournament_match_planning as planning on planning.match_id = match.id
    where match.tournament_id = request.tournament_id
      and match.id not in (request.match_id, request.swap_match_id)
      and swap_team_a_id in (match.team_a_id, match.team_b_id)
      and planning.play_date = request.swap_return_play_date;

    select count(*)::integer into swap_b_original_other
    from public.tournament_matches as match
    join public.tournament_match_planning as planning on planning.match_id = match.id
    where match.tournament_id = request.tournament_id
      and match.id not in (request.match_id, request.swap_match_id)
      and swap_team_b_id in (match.team_a_id, match.team_b_id)
      and planning.play_date = swap_plan.play_date;

    select count(*)::integer into swap_b_target_other
    from public.tournament_matches as match
    join public.tournament_match_planning as planning on planning.match_id = match.id
    where match.tournament_id = request.tournament_id
      and match.id not in (request.match_id, request.swap_match_id)
      and swap_team_b_id in (match.team_a_id, match.team_b_id)
      and planning.play_date = request.swap_return_play_date;

    if swap_a_target_other > swap_a_original_other
      or swap_b_target_other > swap_b_original_other then
      perform public.mark_tournament_reschedule_stale(request.id, 'other_team_daily_load_increased');
      return jsonb_build_object('status', 'stale', 'reason', 'other_team_daily_load_increased');
    end if;

    if (
      exists (
        select 1 from public.tournament_team_availability_slots as availability
        where availability.team_id = swap_team_a_id
      ) and not exists (
        select 1 from public.tournament_team_availability_slots as availability
        where availability.team_id = swap_team_a_id
          and availability.play_date = request.swap_return_play_date
          and availability.starts_at = request.swap_return_starts_at
          and availability.ends_at = request.swap_return_ends_at
      )
    ) or (
      exists (
        select 1 from public.tournament_team_availability_slots as availability
        where availability.team_id = swap_team_b_id
      ) and not exists (
        select 1 from public.tournament_team_availability_slots as availability
        where availability.team_id = swap_team_b_id
          and availability.play_date = request.swap_return_play_date
          and availability.starts_at = request.swap_return_starts_at
          and availability.ends_at = request.swap_return_ends_at
      )
    ) then
      perform public.mark_tournament_reschedule_stale(request.id, 'affected_team_unavailable');
      return jsonb_build_object('status', 'stale', 'reason', 'affected_team_unavailable');
    end if;
  end if;

  if target_match.phase = 'finals' then
    select exists (
      select 1
      from public.tournament_final_planning_nodes as node
      where node.tournament_id = target_match.tournament_id
        and node.series_id = target_match.series_id
        and node.round_number = target_match.final_round_number
        and node.display_order = target_match.display_order
    ) into target_node_exists;

    if target_node_exists and exists (
      select 1
      from public.tournament_final_planning_nodes as node
      where node.tournament_id = target_match.tournament_id
        and node.series_id = target_match.series_id
        and node.round_number = target_match.final_round_number
        and node.display_order = target_match.display_order
        and (
          node.resource_id is distinct from target_plan.resource_id
          or node.play_date is distinct from target_plan.play_date
          or node.starts_at is distinct from target_plan.starts_at
          or node.ends_at is distinct from target_plan.ends_at
        )
    ) then
      perform public.mark_tournament_reschedule_stale(request.id, 'final_grid_changed');
      return jsonb_build_object('status', 'stale', 'reason', 'final_grid_changed');
    end if;

    if request.proposal_kind = 'swap' then
      select exists (
        select 1
        from public.tournament_final_planning_nodes as node
        where node.tournament_id = swap_match.tournament_id
          and node.series_id = swap_match.series_id
          and node.round_number = swap_match.final_round_number
          and node.display_order = swap_match.display_order
      ) into swap_node_exists;

      if swap_node_exists and exists (
        select 1
        from public.tournament_final_planning_nodes as node
        where node.tournament_id = swap_match.tournament_id
          and node.series_id = swap_match.series_id
          and node.round_number = swap_match.final_round_number
          and node.display_order = swap_match.display_order
          and (
            node.resource_id is distinct from swap_plan.resource_id
            or node.play_date is distinct from swap_plan.play_date
            or node.starts_at is distinct from swap_plan.starts_at
            or node.ends_at is distinct from swap_plan.ends_at
          )
      ) then
        perform public.mark_tournament_reschedule_stale(request.id, 'final_grid_changed');
        return jsonb_build_object('status', 'stale', 'reason', 'final_grid_changed');
      end if;
    end if;

    if exists (
      select 1
      from public.tournament_final_planning_nodes as node
      where node.tournament_id = target_match.tournament_id
        and node.resource_id = request.target_resource_id
        and node.play_date = request.target_play_date
        and node.starts_at = request.target_starts_at
        and not (
          node.series_id = target_match.series_id
          and node.round_number = target_match.final_round_number
          and node.display_order = target_match.display_order
        )
        and not (
          request.proposal_kind = 'swap'
          and node.series_id = swap_match.series_id
          and node.round_number = swap_match.final_round_number
          and node.display_order = swap_match.display_order
        )
    ) then
      perform public.mark_tournament_reschedule_stale(request.id, 'final_grid_slot_reserved');
      return jsonb_build_object('status', 'stale', 'reason', 'final_grid_slot_reserved');
    end if;
  end if;

  before_snapshot := jsonb_build_object(
    'match', jsonb_build_object(
      'match_id', target_plan.match_id,
      'resource_id', target_plan.resource_id,
      'play_date', target_plan.play_date,
      'starts_at', target_plan.starts_at,
      'ends_at', target_plan.ends_at,
      'source', target_plan.source
    ),
    'swap_match', case when request.proposal_kind = 'swap' then
      jsonb_build_object(
        'match_id', swap_plan.match_id,
        'resource_id', swap_plan.resource_id,
        'play_date', swap_plan.play_date,
        'starts_at', swap_plan.starts_at,
        'ends_at', swap_plan.ends_at,
        'source', swap_plan.source
      )
      else null
    end
  );

  begin
    if request.proposal_kind = 'free_slot' then
      update public.tournament_match_planning
      set
        resource_id = request.target_resource_id,
        play_date = request.target_play_date,
        starts_at = request.target_starts_at,
        ends_at = request.target_ends_at,
        source = 'manual',
        updated_at = now()
      where match_id = request.match_id;

      if target_match.phase = 'finals' and target_node_exists then
        update public.tournament_final_planning_nodes
        set
          resource_id = request.target_resource_id,
          play_date = request.target_play_date,
          starts_at = request.target_starts_at,
          ends_at = request.target_ends_at,
          source = 'manual',
          updated_at = now()
        where tournament_id = target_match.tournament_id
          and series_id = target_match.series_id
          and round_number = target_match.final_round_number
          and display_order = target_match.display_order;
      end if;

      perform public.sync_tournament_reschedule_match_event(
        request.match_id,
        request.target_resource_id,
        request.target_play_date,
        request.target_starts_at,
        request.target_ends_at
      );
    else
      delete from public.tournament_match_planning
      where match_id in (request.match_id, request.swap_match_id);

      insert into public.tournament_match_planning(
        match_id, tournament_id, resource_id, play_date, starts_at, ends_at,
        source, created_at, updated_at
      ) values (
        target_plan.match_id,
        target_plan.tournament_id,
        request.target_resource_id,
        request.target_play_date,
        request.target_starts_at,
        request.target_ends_at,
        'manual',
        target_plan.created_at,
        now()
      ), (
        swap_plan.match_id,
        swap_plan.tournament_id,
        request.swap_return_resource_id,
        request.swap_return_play_date,
        request.swap_return_starts_at,
        request.swap_return_ends_at,
        'manual',
        swap_plan.created_at,
        now()
      );

      if target_match.phase = 'finals' then
        update public.tournament_final_planning_nodes
        set
          resource_id = null,
          play_date = null,
          starts_at = null,
          ends_at = null,
          source = null,
          updated_at = now()
        where tournament_id = target_match.tournament_id
          and (
            (
              series_id = target_match.series_id
              and round_number = target_match.final_round_number
              and display_order = target_match.display_order
            )
            or (
              series_id = swap_match.series_id
              and round_number = swap_match.final_round_number
              and display_order = swap_match.display_order
            )
          );

        if target_node_exists then
          update public.tournament_final_planning_nodes
          set
            resource_id = request.target_resource_id,
            play_date = request.target_play_date,
            starts_at = request.target_starts_at,
            ends_at = request.target_ends_at,
            source = 'manual',
            updated_at = now()
          where tournament_id = target_match.tournament_id
            and series_id = target_match.series_id
            and round_number = target_match.final_round_number
            and display_order = target_match.display_order;
        end if;

        if swap_node_exists then
          update public.tournament_final_planning_nodes
          set
            resource_id = request.swap_return_resource_id,
            play_date = request.swap_return_play_date,
            starts_at = request.swap_return_starts_at,
            ends_at = request.swap_return_ends_at,
            source = 'manual',
            updated_at = now()
          where tournament_id = swap_match.tournament_id
            and series_id = swap_match.series_id
            and round_number = swap_match.final_round_number
            and display_order = swap_match.display_order;
        end if;
      end if;

      perform public.sync_tournament_reschedule_match_event(
        request.match_id,
        request.target_resource_id,
        request.target_play_date,
        request.target_starts_at,
        request.target_ends_at
      );

      perform public.sync_tournament_reschedule_match_event(
        request.swap_match_id,
        request.swap_return_resource_id,
        request.swap_return_play_date,
        request.swap_return_starts_at,
        request.swap_return_ends_at
      );
    end if;

    update public.tournament_matches
    set updated_at = now()
    where id in (request.match_id, request.swap_match_id);
  exception
    when exclusion_violation or unique_violation then
      mutation_conflict := true;
  end;

  if mutation_conflict then
    perform public.mark_tournament_reschedule_stale(request.id, 'calendar_or_planning_conflict');
    return jsonb_build_object(
      'status', 'stale',
      'reason', 'calendar_or_planning_conflict'
    );
  end if;

  after_snapshot := jsonb_build_object(
    'match', jsonb_build_object(
      'match_id', request.match_id,
      'resource_id', request.target_resource_id,
      'play_date', request.target_play_date,
      'starts_at', request.target_starts_at,
      'ends_at', request.target_ends_at,
      'source', 'manual'
    ),
    'swap_match', case when request.proposal_kind = 'swap' then
      jsonb_build_object(
        'match_id', request.swap_match_id,
        'resource_id', request.swap_return_resource_id,
        'play_date', request.swap_return_play_date,
        'starts_at', request.swap_return_starts_at,
        'ends_at', request.swap_return_ends_at,
        'source', 'manual'
      )
      else null
    end
  );

  update public.tournament_reschedule_requests
  set
    status = 'applied',
    applied_by = auth.uid(),
    applied_at = now(),
    stale_reason = null,
    application_snapshot = jsonb_build_object(
      'before', before_snapshot,
      'after', after_snapshot
    ),
    updated_at = now()
  where id = request.id;

  insert into public.tournament_audit_log(
    tournament_id, action, payload, created_by
  ) values (
    request.tournament_id,
    'reschedule_applied',
    jsonb_build_object(
      'request_id', request.id,
      'proposal_kind', request.proposal_kind,
      'match_id', request.match_id,
      'swap_match_id', request.swap_match_id,
      'before', before_snapshot,
      'after', after_snapshot
    ),
    auth.uid()
  );

  return jsonb_build_object(
    'status', 'applied',
    'request_id', request.id,
    'match_id', request.match_id,
    'swap_match_id', request.swap_match_id,
    'applied_at', now()
  );
end;
$$;

revoke all on function public.admin_apply_tournament_reschedule_request(uuid)
from public, anon;
grant execute on function public.admin_apply_tournament_reschedule_request(uuid)
to authenticated;

-- Enrichit le suivi admin avec la provenance des accords et l'heure
-- d'application, sans exposer les tables internes directement au navigateur.
create or replace function public.admin_list_tournament_reschedule_requests(
  target_tournament_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  result jsonb;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', request.id,
        'tournament_id', request.tournament_id,
        'tournament_name', tournament.name,
        'match_id', request.match_id,
        'requester_team_id', request.requester_team_id,
        'requester_label', public.tournament_team_public_label(request.requester_team_id),
        'proposal_kind', request.proposal_kind,
        'status', request.status,
        'proposal_snapshot', request.proposal_snapshot,
        'stale_reason', request.stale_reason,
        'applied_at', request.applied_at,
        'expires_at', request.expires_at,
        'created_at', request.created_at,
        'approvals', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'team_id', approval.team_id,
                'team_label', public.tournament_team_public_label(approval.team_id),
                'decision', approval.decision,
                'decision_source', approval.decision_source,
                'decision_note', approval.decision_note,
                'is_requester', approval.is_requester,
                'app_actor_count', public.tournament_team_app_actor_count(approval.team_id),
                'decided_at', approval.decided_at
              )
              order by approval.is_requester desc, public.tournament_team_public_label(approval.team_id)
            ),
            '[]'::jsonb
          )
          from public.tournament_reschedule_approvals as approval
          where approval.request_id = request.id
        )
      )
      order by
        case request.status when 'pending' then 0 when 'approved' then 1 else 2 end,
        request.created_at desc
    ),
    '[]'::jsonb
  )
  into result
  from public.tournament_reschedule_requests as request
  join public.tournaments as tournament on tournament.id = request.tournament_id
  where tournament.club_id = target_club_id
    and (target_tournament_id is null or request.tournament_id = target_tournament_id);

  return result;
end;
$$;

revoke all on function public.admin_list_tournament_reschedule_requests(uuid)
from public, anon;
grant execute on function public.admin_list_tournament_reschedule_requests(uuid)
to authenticated;

commit;
