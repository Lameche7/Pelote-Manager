begin;

create or replace function public.admin_list_event_responsibles()
returns table (
  profile_id uuid,
  name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select linked.profile_id, linked.name
  from (
    select distinct on (profiles.id)
      profiles.id as profile_id,
      coalesce(
        nullif(btrim(concat_ws(' ', members.first_name, members.last_name)), ''),
        nullif(btrim(profiles.display_name), ''),
        profiles.email
      ) as name
    from public.club_members as members
    join public.profiles as profiles
      on profiles.id = public.club_member_profile_id(members.id)
    where members.club_id = public.admin_current_club_id()
      and members.is_active
      and public.has_club_permission(members.club_id, 'events.manage')
    order by
      profiles.id,
      members.updated_at desc,
      members.id
  ) as linked
  order by linked.name, linked.profile_id;
$$;

revoke all on function public.admin_list_event_responsibles()
  from public, anon, authenticated;
grant execute on function public.admin_list_event_responsibles()
  to authenticated;

create or replace function public.admin_list_events()
returns table (
  id uuid,
  name text,
  type_name text,
  type_color text,
  starts_at timestamptz,
  ends_at timestamptz,
  resource_names text[],
  responsible_name text,
  publication_status public.event_publication_status,
  visibility public.event_visibility,
  is_blocking boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    event.id,
    event.name,
    event_type.name,
    coalesce(event.color, event_type.color),
    event.starts_at,
    event.ends_at,
    array_agg(resource.name order by resource.name),
    coalesce(
      nullif(
        btrim(
          concat_ws(
            ' ',
            responsible_member.first_name,
            responsible_member.last_name
          )
        ),
        ''
      ),
      nullif(btrim(profile.display_name), ''),
      profile.email
    ),
    event.publication_status,
    event.visibility,
    event.is_blocking
  from public.events as event
  join public.event_types as event_type
    on event_type.id = event.event_type_id
  join public.event_resources as event_resource
    on event_resource.event_id = event.id
  join public.reservable_resources as resource
    on resource.id = event_resource.resource_id
  left join public.profiles as profile
    on profile.id = event.responsible_profile_id
  left join public.club_members as responsible_member
    on responsible_member.id =
      public.profile_club_member_id(profile.id, event.club_id)
  where event.club_id = public.admin_current_club_id()
    and public.has_club_permission(event.club_id, 'events.manage')
    and not exists (
      select 1
      from public.tournament_match_events as tournament_event
      where tournament_event.event_id = event.id
    )
  group by
    event.id,
    event_type.id,
    profile.id,
    responsible_member.id
  order by event.starts_at desc;
$$;

revoke all on function public.admin_list_events()
  from public, anon, authenticated;
grant execute on function public.admin_list_events()
  to authenticated;

create or replace function public.admin_save_event(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  club uuid := public.admin_current_club_id();
  saved_id uuid;
  resource uuid;
  responsible uuid;
  previous_event public.events;
  saved_event public.events;
  resource_ids uuid[];
  previous_resource_ids uuid[];
  target_starts_at timestamptz := (payload->>'starts_at')::timestamptz;
  target_ends_at timestamptz := (payload->>'ends_at')::timestamptz;
  target_is_blocking boolean :=
    coalesce((payload->>'is_blocking')::boolean, false);
  target_status public.event_publication_status :=
    coalesce(
      (payload->>'publication_status')::public.event_publication_status,
      'draft'
    );
begin
  if not public.has_club_permission(club, 'events.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if jsonb_array_length(coalesce(payload->'resource_ids', '[]')) = 0 then
    raise exception 'Au moins un terrain est requis'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.event_types as event_type
    where event_type.id = (payload->>'event_type_id')::uuid
      and event_type.club_id = club
  ) then
    raise exception 'Invalid event type' using errcode = '22023';
  end if;

  responsible := nullif(payload->>'responsible_profile_id', '')::uuid;

  if responsible is not null
    and public.profile_club_member_id(responsible, club) is null
  then
    raise exception 'Le responsable doit être un membre actif du club'
      using errcode = '22023';
  end if;

  saved_id := nullif(payload->>'id', '')::uuid;

  select array_agg(value::uuid order by value::uuid)
  into resource_ids
  from jsonb_array_elements_text(payload->'resource_ids')
    as values_list(value);

  if cardinality(resource_ids) <> (
    select count(distinct ids.id)
    from unnest(resource_ids) as ids(id)
  ) then
    raise exception 'Un terrain ne peut être sélectionné qu’une fois'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(resource_ids) as ids(id)
    where not exists (
      select 1
      from public.reservable_resources as resource_row
      where resource_row.id = ids.id
        and resource_row.club_id = club
        and resource_row.is_active
    )
  ) then
    raise exception 'Invalid resource' using errcode = '22023';
  end if;

  perform 1
  from public.reservable_resources as resource_row
  where resource_row.id = any(resource_ids)
    and resource_row.club_id = club
  order by resource_row.id
  for update;

  if saved_id is not null then
    select *
    into previous_event
    from public.events
    where id = saved_id
      and club_id = club
    for update;

    if previous_event.id is null then
      raise exception 'Event not found' using errcode = 'P0002';
    end if;

    select array_agg(
      event_resource.resource_id
      order by event_resource.resource_id
    )
    into previous_resource_ids
    from public.event_resources as event_resource
    where event_resource.event_id = saved_id;
  end if;

  if target_ends_at <= target_starts_at then
    raise exception 'La fin doit suivre le début' using errcode = '22023';
  end if;

  if target_is_blocking
    and target_status = 'published'
    and exists (
      select 1
      from public.calendar_occupations as occupation
      where occupation.resource_id = any(resource_ids)
        and occupation.cancelled_at is null
        and occupation.starts_at < target_ends_at
        and occupation.ends_at > target_starts_at
        and (
          saved_id is null
          or occupation.id not in (
            select event_resource.calendar_occupation_id
            from public.event_resources as event_resource
            where event_resource.event_id = saved_id
              and event_resource.calendar_occupation_id is not null
          )
        )
    )
  then
    raise exception 'Un terrain est déjà occupé pendant cette période'
      using errcode = '23P01';
  end if;

  if saved_id is null then
    insert into public.events (
      club_id,
      event_type_id,
      name,
      description,
      responsible_profile_id,
      color,
      starts_at,
      ends_at,
      is_blocking,
      visibility,
      publication_status,
      maximum_capacity,
      registration_required,
      archived_at,
      created_by,
      updated_by
    )
    values (
      club,
      (payload->>'event_type_id')::uuid,
      btrim(payload->>'name'),
      nullif(payload->>'description', ''),
      responsible,
      nullif(payload->>'color', ''),
      target_starts_at,
      target_ends_at,
      target_is_blocking,
      coalesce(
        (payload->>'visibility')::public.event_visibility,
        'private'
      ),
      target_status,
      nullif(payload->>'maximum_capacity', '')::integer,
      coalesce((payload->>'registration_required')::boolean, false),
      case when target_status = 'archived' then now() end,
      auth.uid(),
      auth.uid()
    )
    returning id into saved_id;
  else
    update public.events
    set
      event_type_id = (payload->>'event_type_id')::uuid,
      name = btrim(payload->>'name'),
      description = nullif(payload->>'description', ''),
      responsible_profile_id = responsible,
      color = nullif(payload->>'color', ''),
      starts_at = target_starts_at,
      ends_at = target_ends_at,
      is_blocking = target_is_blocking,
      visibility = (payload->>'visibility')::public.event_visibility,
      publication_status = target_status,
      maximum_capacity =
        nullif(payload->>'maximum_capacity', '')::integer,
      registration_required =
        coalesce((payload->>'registration_required')::boolean, false),
      archived_at =
        case
          when target_status = 'archived'
            then coalesce(archived_at, now())
        end,
      updated_at = now(),
      updated_by = auth.uid()
    where id = saved_id
      and club_id = club;

    delete from public.calendar_occupations
    where id in (
      select event_resource.calendar_occupation_id
      from public.event_resources as event_resource
      where event_resource.event_id = saved_id
        and event_resource.calendar_occupation_id is not null
    );

    delete from public.event_resources
    where event_id = saved_id;
  end if;

  foreach resource in array resource_ids loop
    insert into public.event_resources(event_id, resource_id)
    values(saved_id, resource);
  end loop;

  perform public.sync_event_occupations(saved_id);

  select *
  into saved_event
  from public.events
  where id = saved_id;

  insert into public.event_audit_log(
    club_id,
    event_id,
    action,
    actor_id,
    previous_data,
    new_data
  )
  values (
    club,
    saved_id,
    case
      when previous_event.id is null then 'created'
      when previous_event.publication_status <> 'archived'
        and saved_event.publication_status = 'archived'
        then 'archived'
      else 'updated'
    end,
    auth.uid(),
    case
      when previous_event.id is null then null
      else to_jsonb(previous_event)
        || jsonb_build_object('resource_ids', previous_resource_ids)
    end,
    to_jsonb(saved_event)
      || jsonb_build_object('resource_ids', resource_ids)
  );

  return saved_id;
end;
$$;

revoke all on function public.admin_save_event(jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_save_event(jsonb)
  to authenticated;

create or replace function public.admin_publish_communication(
  target_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  club uuid := public.admin_current_club_id();
  previous_communication public.club_communications;
  published_communication public.club_communications;
begin
  if not public.has_club_permission(club, 'communication.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select *
  into previous_communication
  from public.club_communications as communications
  where communications.id = target_id
    and communications.club_id = club
  for update;

  if previous_communication.id is null then
    raise exception 'Communication introuvable'
      using errcode = 'P0002';
  end if;

  if previous_communication.status = 'published' then
    return;
  end if;

  if previous_communication.status = 'archived' then
    raise exception 'Une communication archivée ne peut pas être publiée'
      using errcode = '22023';
  end if;

  if previous_communication.expires_at is not null
    and previous_communication.expires_at <= now()
  then
    raise exception 'La date de fin doit être située dans le futur'
      using errcode = '22023';
  end if;

  update public.club_communications
  set
    status = 'published',
    published_at = now(),
    updated_at = now(),
    updated_by = auth.uid()
  where id = target_id
  returning * into published_communication;

  insert into public.communication_deliveries (
    communication_id,
    club_id,
    club_member_id,
    profile_id_at_publication,
    email_snapshot,
    email_status
  )
  select
    published_communication.id,
    published_communication.club_id,
    members.id,
    profiles.id,
    coalesce(
      nullif(btrim(members.email), ''),
      nullif(btrim(profiles.email), '')
    ),
    case
      when coalesce(
        nullif(btrim(members.email), ''),
        nullif(btrim(profiles.email), '')
      ) is null
        then 'unavailable'::public.communication_email_status
      else 'not_configured'::public.communication_email_status
    end
  from public.club_members as members
  left join public.profiles as profiles
    on profiles.id = public.club_member_profile_id(members.id)
  where members.club_id = published_communication.club_id
    and members.is_active
  on conflict (communication_id, club_member_id) do nothing;

  insert into public.communication_audit_log (
    club_id,
    communication_id,
    action,
    actor_id,
    previous_data,
    new_data
  )
  values (
    club,
    target_id,
    'published',
    auth.uid(),
    to_jsonb(previous_communication),
    to_jsonb(published_communication)
      || jsonb_build_object(
        'recipient_count',
        (
          select count(*)
          from public.communication_deliveries
          where communication_id = target_id
        )
      )
  );
end;
$$;

revoke all on function public.admin_publish_communication(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_publish_communication(uuid)
  to authenticated;

create or replace function public.admin_list_communications()
returns table (
  id uuid,
  title text,
  body text,
  priority public.communication_priority,
  status public.communication_status,
  show_on_home boolean,
  published_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  total_recipients integer,
  in_app_recipients integer,
  read_recipients integer,
  unread_recipients integer,
  without_account integer,
  email_available integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    communications.id,
    communications.title,
    communications.body,
    communications.priority,
    communications.status,
    communications.show_on_home,
    communications.published_at,
    communications.expires_at,
    communications.created_at,
    communications.updated_at,
    coalesce(stats.total_recipients, 0)::integer,
    coalesce(stats.in_app_recipients, 0)::integer,
    coalesce(stats.read_recipients, 0)::integer,
    coalesce(stats.unread_recipients, 0)::integer,
    coalesce(stats.without_account, 0)::integer,
    coalesce(stats.email_available, 0)::integer
  from public.club_communications as communications
  left join lateral (
    select
      count(*) as total_recipients,
      count(*) filter (
        where deliveries.profile_id_at_publication is not null
          or (
            deliveries.club_member_id is not null
            and public.club_member_profile_id(deliveries.club_member_id)
              is not null
          )
      ) as in_app_recipients,
      count(*) filter (
        where deliveries.read_at is not null
      ) as read_recipients,
      count(*) filter (
        where deliveries.read_at is null
          and (
            deliveries.profile_id_at_publication is not null
            or (
              deliveries.club_member_id is not null
              and public.club_member_profile_id(deliveries.club_member_id)
                is not null
            )
          )
      ) as unread_recipients,
      count(*) filter (
        where deliveries.profile_id_at_publication is null
          and (
            deliveries.club_member_id is null
            or public.club_member_profile_id(deliveries.club_member_id)
              is null
          )
      ) as without_account,
      count(*) filter (
        where deliveries.email_snapshot is not null
      ) as email_available
    from public.communication_deliveries as deliveries
    where deliveries.communication_id = communications.id
  ) as stats on true
  where communications.club_id = public.admin_current_club_id()
    and public.has_club_permission(
      communications.club_id,
      'communication.manage'
    )
  order by communications.created_at desc, communications.id;
$$;

revoke all on function public.admin_list_communications()
  from public, anon, authenticated;
grant execute on function public.admin_list_communications()
  to authenticated;

commit;
