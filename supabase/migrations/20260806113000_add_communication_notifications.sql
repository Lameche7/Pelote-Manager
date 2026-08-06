-- Communication V1: audited club announcements, recipient snapshots and in-app notifications.
create type public.communication_priority as enum ('normal', 'important', 'urgent');
create type public.communication_status as enum ('draft', 'published', 'archived');
create type public.communication_email_status as enum (
  'unavailable',
  'not_configured',
  'pending',
  'sent',
  'failed'
);

create table public.club_communications (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  title text not null check (btrim(title) <> ''),
  body text not null check (btrim(body) <> ''),
  priority public.communication_priority not null default 'normal',
  status public.communication_status not null default 'draft',
  show_on_home boolean not null default false,
  published_at timestamptz,
  expires_at timestamptz,
  archived_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'draft') = (published_at is null and archived_at is null)),
  check ((status = 'published') = (published_at is not null and archived_at is null)),
  check (status <> 'archived' or archived_at is not null),
  check (expires_at is null or published_at is null or expires_at > published_at)
);

create table public.communication_deliveries (
  id uuid primary key default gen_random_uuid(),
  communication_id uuid not null references public.club_communications(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  club_member_id uuid not null references public.club_members(id) on delete restrict,
  profile_id_at_publication uuid references public.profiles(id) on delete set null,
  email_snapshot text,
  email_status public.communication_email_status not null default 'unavailable',
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (communication_id, club_member_id)
);

create table public.communication_audit_log (
  id bigint generated always as identity primary key,
  club_id uuid not null references public.clubs(id) on delete cascade,
  communication_id uuid not null,
  action text not null check (action in ('created', 'updated', 'published', 'archived')),
  actor_id uuid references public.profiles(id) on delete set null,
  previous_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index club_communications_club_status_idx
  on public.club_communications (club_id, status, published_at desc);
create index communication_deliveries_member_idx
  on public.communication_deliveries (club_member_id, read_at, created_at desc);
create index communication_deliveries_communication_idx
  on public.communication_deliveries (communication_id);
create index communication_audit_log_communication_idx
  on public.communication_audit_log (club_id, communication_id, created_at desc);

alter table public.club_communications enable row level security;
alter table public.communication_deliveries enable row level security;
alter table public.communication_audit_log enable row level security;

create policy club_communications_manager_read
on public.club_communications
for select
to authenticated
using (public.has_club_permission(club_id, 'communication.manage'));

create policy communication_deliveries_owner_read
on public.communication_deliveries
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles profiles
    join public.club_members members on members.id = profiles.member_id
    where profiles.id = auth.uid()
      and members.id = communication_deliveries.club_member_id
      and members.club_id = communication_deliveries.club_id
      and members.is_active
  )
);

create policy communication_deliveries_owner_update
on public.communication_deliveries
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles profiles
    join public.club_members members on members.id = profiles.member_id
    where profiles.id = auth.uid()
      and members.id = communication_deliveries.club_member_id
      and members.club_id = communication_deliveries.club_id
      and members.is_active
  )
)
with check (
  exists (
    select 1
    from public.profiles profiles
    join public.club_members members on members.id = profiles.member_id
    where profiles.id = auth.uid()
      and members.id = communication_deliveries.club_member_id
      and members.club_id = communication_deliveries.club_id
      and members.is_active
  )
);

create policy communication_audit_manager_read
on public.communication_audit_log
for select
to authenticated
using (public.has_club_permission(club_id, 'communication.manage'));

create function public.admin_list_communications()
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
  select communications.id,
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
  from public.club_communications communications
  left join lateral (
    select count(*) as total_recipients,
           count(*) filter (
             where exists (
               select 1
               from public.profiles profiles
               where profiles.member_id = deliveries.club_member_id
             )
           ) as in_app_recipients,
           count(*) filter (where deliveries.read_at is not null) as read_recipients,
           count(*) filter (
             where deliveries.read_at is null
               and exists (
                 select 1
                 from public.profiles profiles
                 where profiles.member_id = deliveries.club_member_id
               )
           ) as unread_recipients,
           count(*) filter (
             where not exists (
               select 1
               from public.profiles profiles
               where profiles.member_id = deliveries.club_member_id
             )
           ) as without_account,
           count(*) filter (where deliveries.email_snapshot is not null) as email_available
    from public.communication_deliveries deliveries
    where deliveries.communication_id = communications.id
  ) stats on true
  where communications.club_id = public.admin_current_club_id()
    and public.has_club_permission(communications.club_id, 'communication.manage')
  order by communications.created_at desc, communications.id;
$$;

create function public.admin_get_communication(target_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', communications.id,
    'title', communications.title,
    'body', communications.body,
    'priority', communications.priority,
    'status', communications.status,
    'show_on_home', communications.show_on_home,
    'published_at', communications.published_at,
    'expires_at', communications.expires_at
  )
  from public.club_communications communications
  where communications.id = target_id
    and communications.club_id = public.admin_current_club_id()
    and public.has_club_permission(communications.club_id, 'communication.manage');
$$;

create function public.admin_save_communication(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  club uuid := public.admin_current_club_id();
  saved_id uuid := nullif(payload ->> 'id', '')::uuid;
  previous_communication public.club_communications;
  saved_communication public.club_communications;
  target_expires_at timestamptz := nullif(payload ->> 'expires_at', '')::timestamptz;
begin
  if not public.has_club_permission(club, 'communication.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if nullif(btrim(payload ->> 'title'), '') is null
    or nullif(btrim(payload ->> 'body'), '') is null
  then
    raise exception 'Le titre et le message sont obligatoires' using errcode = '22023';
  end if;

  if target_expires_at is not null and target_expires_at <= now() then
    raise exception 'La date de fin doit être située dans le futur' using errcode = '22023';
  end if;

  if saved_id is null then
    insert into public.club_communications (
      club_id,
      title,
      body,
      priority,
      show_on_home,
      expires_at,
      created_by,
      updated_by
    ) values (
      club,
      btrim(payload ->> 'title'),
      btrim(payload ->> 'body'),
      coalesce((payload ->> 'priority')::public.communication_priority, 'normal'),
      coalesce((payload ->> 'show_on_home')::boolean, false),
      target_expires_at,
      auth.uid(),
      auth.uid()
    )
    returning * into saved_communication;
    saved_id := saved_communication.id;

    insert into public.communication_audit_log (
      club_id,
      communication_id,
      action,
      actor_id,
      new_data
    ) values (
      club,
      saved_id,
      'created',
      auth.uid(),
      to_jsonb(saved_communication)
    );
  else
    select *
    into previous_communication
    from public.club_communications communications
    where communications.id = saved_id
      and communications.club_id = club
    for update;

    if previous_communication.id is null then
      raise exception 'Communication introuvable' using errcode = 'P0002';
    end if;

    if previous_communication.status <> 'draft' then
      raise exception 'Une communication publiée ne peut plus être modifiée' using errcode = '22023';
    end if;

    update public.club_communications
    set title = btrim(payload ->> 'title'),
        body = btrim(payload ->> 'body'),
        priority = coalesce((payload ->> 'priority')::public.communication_priority, 'normal'),
        show_on_home = coalesce((payload ->> 'show_on_home')::boolean, false),
        expires_at = target_expires_at,
        updated_at = now(),
        updated_by = auth.uid()
    where id = saved_id
    returning * into saved_communication;

    insert into public.communication_audit_log (
      club_id,
      communication_id,
      action,
      actor_id,
      previous_data,
      new_data
    ) values (
      club,
      saved_id,
      'updated',
      auth.uid(),
      to_jsonb(previous_communication),
      to_jsonb(saved_communication)
    );
  end if;

  return saved_id;
end;
$$;

create function public.admin_publish_communication(target_id uuid)
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
  from public.club_communications communications
  where communications.id = target_id
    and communications.club_id = club
  for update;

  if previous_communication.id is null then
    raise exception 'Communication introuvable' using errcode = 'P0002';
  end if;

  if previous_communication.status = 'published' then
    return;
  end if;

  if previous_communication.status = 'archived' then
    raise exception 'Une communication archivée ne peut pas être publiée' using errcode = '22023';
  end if;

  if previous_communication.expires_at is not null
    and previous_communication.expires_at <= now()
  then
    raise exception 'La date de fin doit être située dans le futur' using errcode = '22023';
  end if;

  update public.club_communications
  set status = 'published',
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
  select published_communication.id,
         published_communication.club_id,
         members.id,
         profiles.id,
         coalesce(nullif(btrim(members.email), ''), nullif(btrim(profiles.email), '')),
         case
           when coalesce(nullif(btrim(members.email), ''), nullif(btrim(profiles.email), '')) is null
             then 'unavailable'::public.communication_email_status
           else 'not_configured'::public.communication_email_status
         end
  from public.club_members members
  left join public.profiles profiles on profiles.member_id = members.id
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
  ) values (
    club,
    target_id,
    'published',
    auth.uid(),
    to_jsonb(previous_communication),
    to_jsonb(published_communication)
      || jsonb_build_object(
        'recipient_count',
        (select count(*) from public.communication_deliveries where communication_id = target_id)
      )
  );
end;
$$;

create function public.admin_archive_communication(target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  club uuid := public.admin_current_club_id();
  previous_communication public.club_communications;
  archived_communication public.club_communications;
begin
  if not public.has_club_permission(club, 'communication.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select *
  into previous_communication
  from public.club_communications communications
  where communications.id = target_id
    and communications.club_id = club
  for update;

  if previous_communication.id is null then
    raise exception 'Communication introuvable' using errcode = 'P0002';
  end if;

  if previous_communication.status = 'archived' then
    return;
  end if;

  update public.club_communications
  set status = 'archived',
      archived_at = now(),
      updated_at = now(),
      updated_by = auth.uid()
  where id = target_id
  returning * into archived_communication;

  insert into public.communication_audit_log (
    club_id,
    communication_id,
    action,
    actor_id,
    previous_data,
    new_data
  ) values (
    club,
    target_id,
    'archived',
    auth.uid(),
    to_jsonb(previous_communication),
    to_jsonb(archived_communication)
  );
end;
$$;

create function public.list_my_notifications()
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
  select deliveries.id,
         communications.id,
         communications.title,
         communications.body,
         communications.priority,
         communications.published_at,
         communications.expires_at,
         deliveries.read_at,
         communications.status = 'published'
           and (communications.expires_at is null or communications.expires_at > now())
  from public.profiles profiles
  join public.club_members members
    on members.id = profiles.member_id
   and members.is_active
  join public.communication_deliveries deliveries
    on deliveries.club_member_id = members.id
   and deliveries.club_id = members.club_id
  join public.club_communications communications
    on communications.id = deliveries.communication_id
   and communications.club_id = deliveries.club_id
  where profiles.id = auth.uid()
    and communications.status in ('published', 'archived')
  order by communications.published_at desc nulls last, communications.id desc;
$$;

create function public.count_my_unread_notifications()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.profiles profiles
  join public.club_members members
    on members.id = profiles.member_id
   and members.is_active
  join public.communication_deliveries deliveries
    on deliveries.club_member_id = members.id
   and deliveries.club_id = members.club_id
  join public.club_communications communications
    on communications.id = deliveries.communication_id
   and communications.club_id = deliveries.club_id
  where profiles.id = auth.uid()
    and deliveries.read_at is null
    and communications.status = 'published'
    and (communications.expires_at is null or communications.expires_at > now());
$$;

create function public.mark_my_notification_read(
  target_delivery_id uuid,
  target_read boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.communication_deliveries deliveries
  set read_at = case when target_read then coalesce(deliveries.read_at, now()) else null end,
      updated_at = now()
  from public.profiles profiles
  join public.club_members members
    on members.id = profiles.member_id
   and members.is_active
  where deliveries.id = target_delivery_id
    and profiles.id = auth.uid()
    and deliveries.club_member_id = members.id
    and deliveries.club_id = members.club_id;

  if not found then
    raise exception 'Notification introuvable' using errcode = 'P0002';
  end if;
end;
$$;

create function public.list_my_home_banners()
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
  select communications.id,
         communications.title,
         communications.body,
         communications.priority,
         communications.published_at,
         communications.expires_at
  from public.profiles profiles
  join public.club_members members
    on members.id = profiles.member_id
   and members.is_active
  join public.communication_deliveries deliveries
    on deliveries.club_member_id = members.id
   and deliveries.club_id = members.club_id
  join public.club_communications communications
    on communications.id = deliveries.communication_id
   and communications.club_id = deliveries.club_id
  where profiles.id = auth.uid()
    and communications.status = 'published'
    and communications.show_on_home
    and (communications.expires_at is null or communications.expires_at > now())
  order by case communications.priority
             when 'urgent' then 1
             when 'important' then 2
             else 3
           end,
           communications.published_at desc
  limit 3;
$$;

revoke all on table public.club_communications from public, anon, authenticated;
revoke all on table public.communication_deliveries from public, anon, authenticated;
revoke all on table public.communication_audit_log from public, anon, authenticated;

revoke all on function public.admin_list_communications() from public;
revoke all on function public.admin_get_communication(uuid) from public;
revoke all on function public.admin_save_communication(jsonb) from public;
revoke all on function public.admin_publish_communication(uuid) from public;
revoke all on function public.admin_archive_communication(uuid) from public;
revoke all on function public.list_my_notifications() from public;
revoke all on function public.count_my_unread_notifications() from public;
revoke all on function public.mark_my_notification_read(uuid, boolean) from public;
revoke all on function public.list_my_home_banners() from public;

grant execute on function public.admin_list_communications() to authenticated;
grant execute on function public.admin_get_communication(uuid) to authenticated;
grant execute on function public.admin_save_communication(jsonb) to authenticated;
grant execute on function public.admin_publish_communication(uuid) to authenticated;
grant execute on function public.admin_archive_communication(uuid) to authenticated;
grant execute on function public.list_my_notifications() to authenticated;
grant execute on function public.count_my_unread_notifications() to authenticated;
grant execute on function public.mark_my_notification_read(uuid, boolean) to authenticated;
grant execute on function public.list_my_home_banners() to authenticated;
