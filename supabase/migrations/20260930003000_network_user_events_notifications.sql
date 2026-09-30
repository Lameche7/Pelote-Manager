begin;

create or replace function public.list_upcoming_events()
returns table (
  id uuid,
  name text,
  description text,
  type_name text,
  type_color text,
  starts_at timestamptz,
  ends_at timestamptz,
  resource_names text[],
  visibility public.event_visibility
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    events.id,
    events.name,
    events.description,
    event_types.name as type_name,
    coalesce(events.color, event_types.color) as type_color,
    events.starts_at,
    events.ends_at,
    coalesce(
      array_agg(resources.name order by resources.name)
        filter (where resources.id is not null),
      array[]::text[]
    ) as resource_names,
    events.visibility
  from public.events as events
  join public.event_types as event_types
    on event_types.id = events.event_type_id
  left join public.event_resources as event_resources
    on event_resources.event_id = events.id
  left join public.reservable_resources as resources
    on resources.id = event_resources.resource_id
  where events.publication_status = 'published'
    and events.ends_at > now()
    and (
      events.visibility = 'public'
      or (
        events.visibility = 'members'
        and auth.uid() is not null
        and (
          public.profile_club_member_id(auth.uid(), events.club_id) is not null
          or exists (
            select 1
            from public.club_memberships as memberships
            where memberships.profile_id = auth.uid()
              and memberships.club_id = events.club_id
          )
        )
      )
    )
  group by events.id, event_types.id
  order by events.starts_at, events.id
  limit 12;
$$;

revoke all on function public.list_upcoming_events()
  from public, anon, authenticated;
grant execute on function public.list_upcoming_events()
  to anon, authenticated;

create or replace function public.list_my_notifications()
returns table (
  delivery_id uuid,
  communication_id uuid,
  title text,
  body text,
  priority public.communication_priority,
  published_at timestamptz,
  expires_at timestamptz,
  read_at timestamptz,
  is_active boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    notification.delivery_id,
    notification.communication_id,
    notification.title,
    notification.body,
    notification.priority,
    notification.published_at,
    notification.expires_at,
    notification.read_at,
    notification.is_active
  from public.list_my_notifications_v2() as notification;
$$;

revoke all on function public.list_my_notifications()
  from public, anon, authenticated;
grant execute on function public.list_my_notifications()
  to authenticated;

create or replace function public.count_my_unread_notifications()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.list_my_notifications_v2() as notification
  where notification.read_at is null
    and notification.is_active;
$$;

revoke all on function public.count_my_unread_notifications()
  from public, anon, authenticated;
grant execute on function public.count_my_unread_notifications()
  to authenticated;

create or replace function public.mark_my_notification_read(
  target_delivery_id uuid,
  target_read boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  update public.communication_deliveries as deliveries
  set
    read_at = case
      when target_read then coalesce(deliveries.read_at, now())
      else null
    end,
    updated_at = now()
  where deliveries.id = target_delivery_id
    and (
      deliveries.profile_id_at_publication = auth.uid()
      or (
        deliveries.club_member_id is not null
        and deliveries.club_member_id =
          public.profile_club_member_id(auth.uid(), deliveries.club_id)
      )
    );

  if not found then
    raise exception 'Notification introuvable' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.mark_my_notification_read(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.mark_my_notification_read(uuid, boolean)
  to authenticated;

create or replace function public.delete_my_notification(
  target_delivery_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  update public.communication_deliveries as deliveries
  set
    deleted_at = coalesce(deliveries.deleted_at, now()),
    updated_at = now()
  where deliveries.id = target_delivery_id
    and (
      deliveries.profile_id_at_publication = auth.uid()
      or (
        deliveries.club_member_id is not null
        and deliveries.club_member_id =
          public.profile_club_member_id(auth.uid(), deliveries.club_id)
      )
    );

  if not found then
    raise exception 'Notification introuvable' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.delete_my_notification(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_my_notification(uuid)
  to authenticated;

create or replace function public.list_my_home_banners()
returns table (
  communication_id uuid,
  title text,
  body text,
  priority public.communication_priority,
  published_at timestamptz,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    notification.communication_id,
    notification.title,
    notification.body,
    notification.priority,
    notification.published_at,
    notification.expires_at
  from public.list_my_notifications_v2() as notification
  join public.club_communications as communication
    on communication.id = notification.communication_id
  where notification.is_active
    and communication.show_on_home
  order by
    case notification.priority
      when 'urgent' then 1
      when 'important' then 2
      else 3
    end,
    notification.published_at desc
  limit 3;
$$;

revoke all on function public.list_my_home_banners()
  from public, anon, authenticated;
grant execute on function public.list_my_home_banners()
  to authenticated;

commit;
