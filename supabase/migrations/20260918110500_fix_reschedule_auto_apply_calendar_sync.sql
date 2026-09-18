begin;

-- Corrige trois problèmes liés à l'application des reports :
-- 1) certaines installations n'avaient pas reçu le patch d'auto-application ;
-- 2) le déplacement supprimait event_resources avant l'ancienne occupation,
--    ce qui laissait un créneau fantôme dans le calendrier ;
-- 3) un échange pouvait laisser deux anciens créneaux fantômes.

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

  -- IMPORTANT : supprimer l'occupation AVANT de supprimer event_resources.
  -- Sinon calendar_occupation_id devient introuvable et l'ancien créneau reste
  -- occupé alors que le match a déjà été déplacé.
  delete from public.calendar_occupations as occupation
  using public.event_resources as event_resource
  where event_resource.event_id = target_event_id
    and event_resource.calendar_occupation_id = occupation.id;

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

revoke all on function public.sync_tournament_reschedule_match_event(
  uuid, uuid, date, time, time
)
from public, anon, authenticated;

-- Remet en place le patch d'auto-application de façon idempotente.
do $$
declare
  source_definition text;
  patched_definition text;
begin
  source_definition := replace(
    pg_get_functiondef(
      'public.admin_apply_tournament_reschedule_request(uuid)'::regprocedure
    ),
    chr(13),
    ''
  );

  if position('caller_can_apply' in source_definition) = 0 then
    patched_definition := replace(
      source_definition,
      'target_club_id uuid := public.admin_current_club_id();',
      E'target_club_id uuid;\n  caller_can_apply boolean := false;'
    );
    if patched_definition = source_definition then
      raise exception 'Could not patch reschedule application declaration';
    end if;
    source_definition := patched_definition;

    patched_definition := replace(
      source_definition,
      E'begin\n  if not public.has_club_permission(target_club_id, ''tournaments.manage'') then\n    raise exception ''Forbidden'' using errcode = ''42501'';\n  end if;\n\n  select item.*',
      E'begin\n  if auth.uid() is null then\n    raise exception ''Authentication required'' using errcode = ''42501'';\n  end if;\n\n  select item.*'
    );
    if patched_definition = source_definition then
      raise exception 'Could not replace admin-only reschedule application guard';
    end if;
    source_definition := patched_definition;

    patched_definition := replace(
      source_definition,
      E'  select item.*\n  into tournament\n  from public.tournaments as item\n  where item.id = request.tournament_id\n    and item.club_id = target_club_id\n  for update;\n\n  if tournament.id is null then\n    raise exception ''Tournament reschedule request is outside this club''\n      using errcode = ''42501'';\n  end if;',
      E'  select item.*\n  into tournament\n  from public.tournaments as item\n  where item.id = request.tournament_id\n  for update;\n\n  if tournament.id is null then\n    raise exception ''Tournament reschedule tournament not found''\n      using errcode = ''P0002'';\n  end if;\n\n  target_club_id := tournament.club_id;\n  caller_can_apply := public.has_club_permission(target_club_id, ''tournaments.manage'')\n    or exists (\n      select 1\n      from public.tournament_reschedule_approvals as approval\n      where approval.request_id = request.id\n        and public.tournament_profile_can_act_for_team(approval.team_id, auth.uid())\n    );\n\n  if not caller_can_apply then\n    raise exception ''Forbidden'' using errcode = ''42501'';\n  end if;'
    );
    if patched_definition = source_definition then
      raise exception 'Could not replace club-scoped reschedule application guard';
    end if;

    execute patched_definition;
  end if;
end;
$$;

do $$
declare
  source_definition text;
  patched_definition text;
begin
  source_definition := replace(
    pg_get_functiondef(
      'public.decide_my_tournament_reschedule_request(uuid,uuid,text)'::regprocedure
    ),
    chr(13),
    ''
  );

  if position(
    'admin_apply_tournament_reschedule_request(request.id)'
    in source_definition
  ) = 0 then
    patched_definition := replace(
      source_definition,
      '  next_status text;',
      E'  next_status text;\n  application_result jsonb;'
    );
    if patched_definition = source_definition then
      raise exception 'Could not patch player reschedule decision declaration';
    end if;
    source_definition := patched_definition;

    patched_definition := replace(
      source_definition,
      E'  return next_status;\nend;',
      E'  if next_status = ''approved'' then\n    application_result := public.admin_apply_tournament_reschedule_request(request.id);\n    return coalesce(application_result->>''status'', next_status);\n  end if;\n\n  return next_status;\nend;'
    );
    if patched_definition = source_definition then
      raise exception 'Could not patch player reschedule auto-application';
    end if;

    execute patched_definition;
  end if;
end;
$$;

do $$
declare
  source_definition text;
  patched_definition text;
begin
  source_definition := replace(
    pg_get_functiondef(
      'public.admin_record_tournament_reschedule_offline_decision(uuid,uuid,text,text)'::regprocedure
    ),
    chr(13),
    ''
  );

  if position(
    'admin_apply_tournament_reschedule_request(target_request.id)'
    in source_definition
  ) = 0 then
    patched_definition := replace(
      source_definition,
      '  cleaned_note text := nullif(btrim(contact_note), '''');',
      E'  cleaned_note text := nullif(btrim(contact_note), '''');\n  application_result jsonb;'
    );
    if patched_definition = source_definition then
      raise exception 'Could not patch offline reschedule decision declaration';
    end if;
    source_definition := patched_definition;

    patched_definition := replace(
      source_definition,
      E'  return next_status;\nend;',
      E'  if next_status = ''approved'' then\n    application_result := public.admin_apply_tournament_reschedule_request(target_request.id);\n    return coalesce(application_result->>''status'', next_status);\n  end if;\n\n  return next_status;\nend;'
    );
    if patched_definition = source_definition then
      raise exception 'Could not patch offline reschedule auto-application';
    end if;

    execute patched_definition;
  end if;
end;
$$;

-- Répare les occupations fantômes laissées par les reports déjà appliqués.
do $$
declare
  orphan record;
  previous_occupation public.calendar_occupations%rowtype;
  cancelled_occupation public.calendar_occupations%rowtype;
begin
  for orphan in
    with moved as (
      select
        request.id as request_id,
        request.match_id,
        nullif(request.application_snapshot#>>'{before,match,resource_id}', '')::uuid as resource_id,
        nullif(request.application_snapshot#>>'{before,match,play_date}', '')::date as play_date,
        nullif(request.application_snapshot#>>'{before,match,starts_at}', '')::time as starts_at,
        nullif(request.application_snapshot#>>'{before,match,ends_at}', '')::time as ends_at
      from public.tournament_reschedule_requests as request
      where request.status = 'applied'
        and request.application_snapshot is not null

      union all

      select
        request.id,
        request.swap_match_id,
        nullif(request.application_snapshot#>>'{before,swap_match,resource_id}', '')::uuid,
        nullif(request.application_snapshot#>>'{before,swap_match,play_date}', '')::date,
        nullif(request.application_snapshot#>>'{before,swap_match,starts_at}', '')::time,
        nullif(request.application_snapshot#>>'{before,swap_match,ends_at}', '')::time
      from public.tournament_reschedule_requests as request
      where request.status = 'applied'
        and request.proposal_kind = 'swap'
        and request.swap_match_id is not null
        and request.application_snapshot#>>'{before,swap_match,resource_id}' is not null
    ),
    expected as (
      select
        moved.*,
        public.tournament_planning_starts_at(
          moved.play_date, moved.starts_at, resource.timezone
        ) as starts_ts,
        public.tournament_planning_starts_at(
          moved.play_date, moved.ends_at, resource.timezone
        ) as ends_ts,
        event.name as event_name
      from moved
      join public.reservable_resources as resource on resource.id = moved.resource_id
      left join public.tournament_match_events as match_event
        on match_event.match_id = moved.match_id
      left join public.events as event
        on event.id = match_event.event_id
       and event.publication_status = 'published'
    )
    select
      occupation.id as occupation_id
    from expected
    join public.calendar_occupations as occupation
      on occupation.resource_id = expected.resource_id
     and occupation.starts_at = expected.starts_ts
     and occupation.ends_at = expected.ends_ts
     and occupation.cancelled_at is null
    left join public.event_resources as event_resource
      on event_resource.calendar_occupation_id = occupation.id
    where occupation.reservation_id is null
      and occupation.occupation_type = 'club_event'
      and event_resource.event_id is null
      and (expected.event_name is null or occupation.title = expected.event_name)
  loop
    select occupation.*
    into previous_occupation
    from public.calendar_occupations as occupation
    where occupation.id = orphan.occupation_id
      and occupation.cancelled_at is null
    for update;

    if previous_occupation.id is not null then
      update public.calendar_occupations
      set
        cancelled_at = now(),
        updated_at = now(),
        updated_by = null
      where id = previous_occupation.id
      returning * into cancelled_occupation;

      insert into public.calendar_occupation_audit_log(
        occupation_id,
        action,
        actor_id,
        previous_data,
        new_data
      ) values (
        previous_occupation.id,
        'reschedule_orphan_released',
        null,
        to_jsonb(previous_occupation),
        to_jsonb(cancelled_occupation)
      );
    end if;
  end loop;
end;
$$;

commit;
