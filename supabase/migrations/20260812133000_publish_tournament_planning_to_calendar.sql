begin;

-- PR77 — Publication du planning tournoi dans le calendrier global.
-- Les matchs restent la source métier du tournoi ; chaque match publié possède
-- un événement générique associé. L'Event Engine projette ensuite cet événement
-- dans calendar_occupations, qui reste la source unique utilisée par les
-- réservations pour détecter les indisponibilités.

create table public.tournament_match_events (
  match_id uuid primary key references public.tournament_matches (id) on delete cascade,
  event_id uuid not null unique references public.events (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index tournament_match_events_event_idx
on public.tournament_match_events (event_id);

alter table public.tournament_match_events enable row level security;
revoke all on table public.tournament_match_events from public, anon, authenticated;

-- Un événement piloté par un tournoi ne doit pas pouvoir être modifié depuis
-- l'administration générique des événements. Les RPC de publication activent
-- explicitement ce garde-fou pour la durée de leur transaction.
create or replace function public.protect_tournament_managed_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.tournament_match_events as link
    where link.event_id = old.id
  ) and coalesce(current_setting('app.allow_tournament_event_sync', true), '') <> 'on' then
    raise exception 'Tournament-managed event must be changed from tournament planning'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger protect_tournament_managed_event_update
before update or delete on public.events
for each row execute function public.protect_tournament_managed_event();

create or replace function public.tournament_team_public_label(target_team_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(
      string_agg(
        nullif(btrim(concat_ws(' ', player.first_name, player.last_name)), ''),
        ' / '
        order by player.display_order
      ),
      ''
    ),
    'Équipe'
  )
  from public.tournament_team_players as player
  where player.team_id = target_team_id;
$$;

create or replace function public.tournament_planning_starts_at(
  target_date date,
  target_time time,
  target_timezone text
)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select (target_date + target_time) at time zone target_timezone;
$$;

create or replace function public.admin_list_tournament_publications()
returns table (
  id uuid,
  name text,
  status public.tournament_status,
  starts_on date,
  ends_on date,
  match_count integer,
  published_match_count integer,
  conflict_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    tournament.id,
    tournament.name,
    tournament.status,
    tournament.starts_on,
    tournament.ends_on,
    (
      select count(*)::integer
      from public.tournament_matches as match
      where match.tournament_id = tournament.id
    ) as match_count,
    (
      select count(*)::integer
      from public.tournament_matches as match
      join public.tournament_match_events as link on link.match_id = match.id
      join public.events as event on event.id = link.event_id
      where match.tournament_id = tournament.id
        and event.publication_status = 'published'
    ) as published_match_count,
    (
      select count(*)::integer
      from public.tournament_match_planning as planning
      join public.reservable_resources as resource on resource.id = planning.resource_id
      where planning.tournament_id = tournament.id
        and exists (
          select 1
          from public.calendar_occupations as occupation
          where occupation.resource_id = planning.resource_id
            and occupation.cancelled_at is null
            and occupation.starts_at < public.tournament_planning_starts_at(
              planning.play_date,
              planning.ends_at,
              resource.timezone
            )
            and occupation.ends_at > public.tournament_planning_starts_at(
              planning.play_date,
              planning.starts_at,
              resource.timezone
            )
            and occupation.id not in (
              select event_resource.calendar_occupation_id
              from public.tournament_match_events as own_link
              join public.event_resources as event_resource
                on event_resource.event_id = own_link.event_id
              where own_link.match_id = planning.match_id
                and event_resource.calendar_occupation_id is not null
            )
        )
    ) as conflict_count
  from public.tournaments as tournament
  where tournament.club_id = public.admin_current_club_id()
    and public.has_club_permission(tournament.club_id, 'tournaments.manage')
    and tournament.status in ('planning_generated', 'planning_published')
  order by tournament.starts_on, tournament.name;
$$;

create or replace function public.admin_get_tournament_publication_preview(
  target_tournament_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_tournament public.tournaments;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id
    and tournament.club_id = target_club_id;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if target_tournament.status not in ('planning_generated', 'planning_published') then
    raise exception 'Tournament publication is not available at this stage'
      using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'tournament', jsonb_build_object(
      'id', target_tournament.id,
      'name', target_tournament.name,
      'status', target_tournament.status,
      'starts_on', target_tournament.starts_on,
      'ends_on', target_tournament.ends_on
    ),
    'match_count', (
      select count(*)
      from public.tournament_matches as match
      where match.tournament_id = target_tournament.id
    ),
    'planned_match_count', (
      select count(*)
      from public.tournament_match_planning as planning
      where planning.tournament_id = target_tournament.id
    ),
    'published_match_count', (
      select count(*)
      from public.tournament_matches as match
      join public.tournament_match_events as link on link.match_id = match.id
      join public.events as event on event.id = link.event_id
      where match.tournament_id = target_tournament.id
        and event.publication_status = 'published'
    ),
    'conflicts', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'match_id', planning.match_id,
            'resource_id', planning.resource_id,
            'resource_name', resource.name,
            'play_date', planning.play_date,
            'starts_at', planning.starts_at,
            'ends_at', planning.ends_at,
            'match_label', concat(
              series.name,
              ' · ',
              public.tournament_team_public_label(match.team_a_id),
              ' — ',
              public.tournament_team_public_label(match.team_b_id)
            ),
            'occupation_id', occupation.id,
            'occupation_type', occupation.occupation_type,
            'occupation_title', occupation.title,
            'occupation_starts_at', occupation.starts_at,
            'occupation_ends_at', occupation.ends_at
          )
          order by planning.play_date, planning.starts_at, resource.name
        ),
        '[]'::jsonb
      )
      from public.tournament_match_planning as planning
      join public.tournament_matches as match on match.id = planning.match_id
      join public.tournament_series as series on series.id = match.series_id
      join public.reservable_resources as resource on resource.id = planning.resource_id
      join public.calendar_occupations as occupation
        on occupation.resource_id = planning.resource_id
       and occupation.cancelled_at is null
       and occupation.starts_at < public.tournament_planning_starts_at(
         planning.play_date,
         planning.ends_at,
         resource.timezone
       )
       and occupation.ends_at > public.tournament_planning_starts_at(
         planning.play_date,
         planning.starts_at,
         resource.timezone
       )
      where planning.tournament_id = target_tournament.id
        and occupation.id not in (
          select event_resource.calendar_occupation_id
          from public.tournament_match_events as own_link
          join public.event_resources as event_resource
            on event_resource.event_id = own_link.event_id
          where own_link.match_id = planning.match_id
            and event_resource.calendar_occupation_id is not null
        )
    )
  );
end;
$$;

create or replace function public.admin_publish_tournament_planning(
  target_tournament_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_tournament public.tournaments;
  tournament_event_type_id uuid;
  expected_count integer;
  planned_count integer;
  item record;
  target_event_id uuid;
  previous_event public.events;
  saved_event public.events;
  event_action text;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id
    and tournament.club_id = target_club_id
  for update;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if target_tournament.status <> 'planning_generated' then
    raise exception 'Tournament planning must be generated before publication'
      using errcode = 'P0001';
  end if;

  select count(*)::integer
  into expected_count
  from public.tournament_matches as match
  where match.tournament_id = target_tournament.id;

  select count(*)::integer
  into planned_count
  from public.tournament_match_planning as planning
  where planning.tournament_id = target_tournament.id;

  if expected_count = 0 or planned_count <> expected_count then
    raise exception 'Tournament planning must be complete before publication'
      using errcode = 'P0001';
  end if;

  -- Verrouille les terrains dans un ordre déterministe avant le contrôle global.
  perform 1
  from public.reservable_resources as resource
  where resource.id in (
    select distinct planning.resource_id
    from public.tournament_match_planning as planning
    where planning.tournament_id = target_tournament.id
  )
  order by resource.id
  for update;

  -- Le planning lui-même ne doit pas contenir deux matchs qui se chevauchent
  -- sur un même terrain, même si leurs heures de début diffèrent.
  if exists (
    select 1
    from public.tournament_match_planning as left_planning
    join public.tournament_match_planning as right_planning
      on right_planning.tournament_id = left_planning.tournament_id
     and right_planning.resource_id = left_planning.resource_id
     and right_planning.match_id > left_planning.match_id
    join public.reservable_resources as resource
      on resource.id = left_planning.resource_id
    where left_planning.tournament_id = target_tournament.id
      and public.tournament_planning_starts_at(
        left_planning.play_date,
        left_planning.starts_at,
        resource.timezone
      ) < public.tournament_planning_starts_at(
        right_planning.play_date,
        right_planning.ends_at,
        resource.timezone
      )
      and public.tournament_planning_starts_at(
        left_planning.play_date,
        left_planning.ends_at,
        resource.timezone
      ) > public.tournament_planning_starts_at(
        right_planning.play_date,
        right_planning.starts_at,
        resource.timezone
      )
  ) then
    raise exception 'Tournament planning contains overlapping matches'
      using errcode = 'P0001';
  end if;

  -- Contrôle contre les réservations, fermetures, maintenances et événements
  -- déjà publiés. Les éventuelles anciennes projections du même match sont
  -- ignorées afin de permettre une republication après retrait du calendrier.
  if exists (
    select 1
    from public.tournament_match_planning as planning
    join public.reservable_resources as resource on resource.id = planning.resource_id
    join public.calendar_occupations as occupation
      on occupation.resource_id = planning.resource_id
     and occupation.cancelled_at is null
     and occupation.starts_at < public.tournament_planning_starts_at(
       planning.play_date,
       planning.ends_at,
       resource.timezone
     )
     and occupation.ends_at > public.tournament_planning_starts_at(
       planning.play_date,
       planning.starts_at,
       resource.timezone
     )
    where planning.tournament_id = target_tournament.id
      and occupation.id not in (
        select event_resource.calendar_occupation_id
        from public.tournament_match_events as own_link
        join public.event_resources as event_resource
          on event_resource.event_id = own_link.event_id
        where own_link.match_id = planning.match_id
          and event_resource.calendar_occupation_id is not null
      )
  ) then
    raise exception 'Tournament publication conflicts with calendar'
      using errcode = '23P01';
  end if;

  select event_type.id
  into tournament_event_type_id
  from public.event_types as event_type
  where event_type.club_id = target_club_id
    and lower(event_type.name) = lower('Tournoi')
  order by event_type.display_order, event_type.id
  limit 1;

  if tournament_event_type_id is null then
    insert into public.event_types (
      club_id,
      name,
      color,
      icon,
      display_order
    )
    values (
      target_club_id,
      'Tournoi',
      '#DC2626',
      'trophy',
      10
    )
    returning id into tournament_event_type_id;
  end if;

  perform set_config('app.allow_tournament_event_sync', 'on', true);

  for item in
    select
      match.id as match_id,
      match.team_a_id,
      match.team_b_id,
      pool.display_order as pool_display_order,
      series.name as series_name,
      series.color as series_color,
      planning.resource_id,
      resource.name as resource_name,
      resource.timezone as resource_timezone,
      planning.play_date,
      planning.starts_at,
      planning.ends_at,
      link.event_id as existing_event_id
    from public.tournament_matches as match
    join public.tournament_pools as pool on pool.id = match.pool_id
    join public.tournament_series as series on series.id = match.series_id
    join public.tournament_match_planning as planning on planning.match_id = match.id
    join public.reservable_resources as resource on resource.id = planning.resource_id
    left join public.tournament_match_events as link on link.match_id = match.id
    where match.tournament_id = target_tournament.id
    order by planning.play_date, planning.starts_at, resource.name, match.id
  loop
    target_event_id := item.existing_event_id;
    previous_event := null;

    if target_event_id is null then
      insert into public.events (
        club_id,
        event_type_id,
        name,
        description,
        color,
        starts_at,
        ends_at,
        is_blocking,
        visibility,
        publication_status,
        registration_required,
        created_by,
        updated_by
      )
      values (
        target_club_id,
        tournament_event_type_id,
        concat(
          item.series_name,
          ' · ',
          public.tournament_team_public_label(item.team_a_id),
          ' — ',
          public.tournament_team_public_label(item.team_b_id)
        ),
        concat(
          target_tournament.name,
          ' · Poule ',
          item.pool_display_order + 1
        ),
        item.series_color,
        public.tournament_planning_starts_at(
          item.play_date,
          item.starts_at,
          item.resource_timezone
        ),
        public.tournament_planning_starts_at(
          item.play_date,
          item.ends_at,
          item.resource_timezone
        ),
        true,
        'public',
        'published',
        false,
        auth.uid(),
        auth.uid()
      )
      returning id into target_event_id;

      insert into public.tournament_match_events (match_id, event_id)
      values (item.match_id, target_event_id);

      event_action := 'created';
    else
      select event.*
      into previous_event
      from public.events as event
      where event.id = target_event_id
        and event.club_id = target_club_id
      for update;

      if previous_event.id is null then
        raise exception 'Tournament calendar event is invalid' using errcode = 'P0001';
      end if;

      update public.events
      set
        event_type_id = tournament_event_type_id,
        name = concat(
          item.series_name,
          ' · ',
          public.tournament_team_public_label(item.team_a_id),
          ' — ',
          public.tournament_team_public_label(item.team_b_id)
        ),
        description = concat(
          target_tournament.name,
          ' · Poule ',
          item.pool_display_order + 1
        ),
        color = item.series_color,
        starts_at = public.tournament_planning_starts_at(
          item.play_date,
          item.starts_at,
          item.resource_timezone
        ),
        ends_at = public.tournament_planning_starts_at(
          item.play_date,
          item.ends_at,
          item.resource_timezone
        ),
        is_blocking = true,
        visibility = 'public',
        publication_status = 'published',
        archived_at = null,
        updated_by = auth.uid(),
        updated_at = now()
      where id = target_event_id;

      delete from public.event_resources
      where event_id = target_event_id;

      event_action := 'updated';
    end if;

    insert into public.event_resources (event_id, resource_id)
    values (target_event_id, item.resource_id);

    perform public.sync_event_occupations(target_event_id);

    select event.*
    into saved_event
    from public.events as event
    where event.id = target_event_id;

    insert into public.event_audit_log (
      club_id,
      event_id,
      action,
      actor_id,
      previous_data,
      new_data
    )
    values (
      target_club_id,
      target_event_id,
      event_action,
      auth.uid(),
      case when previous_event.id is null then null else to_jsonb(previous_event) end,
      to_jsonb(saved_event) || jsonb_build_object('resource_ids', jsonb_build_array(item.resource_id))
    );
  end loop;

  update public.tournaments
  set
    status = 'planning_published',
    updated_by = auth.uid(),
    updated_at = now()
  where id = target_tournament.id;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    target_tournament.id,
    'planning_published',
    'planning_generated',
    'planning_published',
    jsonb_build_object('match_count', expected_count),
    auth.uid()
  );

  return expected_count;
exception
  when exclusion_violation then
    raise exception 'Tournament publication conflicts with calendar'
      using errcode = '23P01';
end;
$$;

create or replace function public.admin_unpublish_tournament_planning(
  target_tournament_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_tournament public.tournaments;
  item record;
  previous_event public.events;
  saved_event public.events;
  unpublished_count integer := 0;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id
    and tournament.club_id = target_club_id
  for update;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if target_tournament.status <> 'planning_published' then
    raise exception 'Tournament planning is not published'
      using errcode = 'P0001';
  end if;

  perform 1
  from public.reservable_resources as resource
  where resource.id in (
    select distinct event_resource.resource_id
    from public.tournament_matches as match
    join public.tournament_match_events as link on link.match_id = match.id
    join public.event_resources as event_resource on event_resource.event_id = link.event_id
    where match.tournament_id = target_tournament.id
  )
  order by resource.id
  for update;

  perform set_config('app.allow_tournament_event_sync', 'on', true);

  for item in
    select link.event_id
    from public.tournament_matches as match
    join public.tournament_match_events as link on link.match_id = match.id
    where match.tournament_id = target_tournament.id
    order by link.event_id
  loop
    select event.*
    into previous_event
    from public.events as event
    where event.id = item.event_id
      and event.club_id = target_club_id
    for update;

    if previous_event.id is null then
      raise exception 'Tournament calendar event is invalid' using errcode = 'P0001';
    end if;

    update public.events
    set
      publication_status = 'archived',
      archived_at = now(),
      updated_by = auth.uid(),
      updated_at = now()
    where id = item.event_id
    returning * into saved_event;

    perform public.sync_event_occupations(item.event_id);

    insert into public.event_audit_log (
      club_id,
      event_id,
      action,
      actor_id,
      previous_data,
      new_data
    )
    values (
      target_club_id,
      item.event_id,
      'archived',
      auth.uid(),
      to_jsonb(previous_event),
      to_jsonb(saved_event)
    );

    unpublished_count := unpublished_count + 1;
  end loop;

  update public.tournaments
  set
    status = 'planning_generated',
    updated_by = auth.uid(),
    updated_at = now()
  where id = target_tournament.id;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    target_tournament.id,
    'planning_unpublished',
    'planning_published',
    'planning_generated',
    jsonb_build_object('match_count', unpublished_count),
    auth.uid()
  );

  return unpublished_count;
end;
$$;

revoke all on function public.protect_tournament_managed_event() from public, anon, authenticated;
revoke all on function public.tournament_team_public_label(uuid) from public, anon, authenticated;
revoke all on function public.tournament_planning_starts_at(date, time, text) from public, anon, authenticated;
revoke all on function public.admin_list_tournament_publications() from public, anon, authenticated;
revoke all on function public.admin_get_tournament_publication_preview(uuid) from public, anon, authenticated;
revoke all on function public.admin_publish_tournament_planning(uuid) from public, anon, authenticated;
revoke all on function public.admin_unpublish_tournament_planning(uuid) from public, anon, authenticated;

grant execute on function public.admin_list_tournament_publications() to authenticated;
grant execute on function public.admin_get_tournament_publication_preview(uuid) to authenticated;
grant execute on function public.admin_publish_tournament_planning(uuid) to authenticated;
grant execute on function public.admin_unpublish_tournament_planning(uuid) to authenticated;

commit;
