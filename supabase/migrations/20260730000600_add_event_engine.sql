-- Generic club event engine. Events are the source of truth; blocking events are
-- projected into the existing calendar occupation engine used by reservations.
create type public.event_publication_status as enum ('draft', 'published', 'archived');
create type public.event_visibility as enum ('public', 'members', 'private');

create table public.event_types (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  color text not null default '#2563eb' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  icon text,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, name)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  event_type_id uuid not null references public.event_types(id),
  name text not null check (btrim(name) <> ''),
  description text,
  responsible_profile_id uuid references public.profiles(id) on delete set null,
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_blocking boolean not null default false,
  visibility public.event_visibility not null default 'private',
  publication_status public.event_publication_status not null default 'draft',
  maximum_capacity integer check (maximum_capacity is null or maximum_capacity > 0),
  registration_required boolean not null default false,
  archived_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((publication_status = 'archived') = (archived_at is not null))
);

create table public.event_resources (
  event_id uuid not null references public.events(id) on delete cascade,
  resource_id uuid not null references public.reservable_resources(id) on delete cascade,
  calendar_occupation_id uuid unique references public.calendar_occupations(id) on delete set null,
  primary key (event_id, resource_id)
);

-- Reserved extension point for document management; storage/upload workflows
-- deliberately remain outside this PR.
create table public.event_documents (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  storage_path text not null check (btrim(storage_path) <> ''),
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index events_club_period_idx on public.events(club_id, starts_at, ends_at);
create index events_club_status_idx on public.events(club_id, publication_status);
create index event_resources_resource_idx on public.event_resources(resource_id);
create index event_documents_event_idx on public.event_documents(event_id);

insert into public.event_types (club_id, name, color, icon, display_order)
select clubs.id, seed.name, seed.color, seed.icon, seed.ord
from public.clubs
cross join (values
 ('Tournoi','#dc2626','trophy',10), ('Championnat','#ea580c','medal',20),
 ('Stage','#2563eb','graduation-cap',30), ('Entraînement','#7c3aed','activity',40),
 ('Réunion','#0891b2','users',50), ('Animation','#db2777','party-popper',60),
 ('Travaux','#6b7280','hammer',70), ('Maintenance','#475569','wrench',80),
 ('Assemblée Générale','#15803d','landmark',90), ('Formation','#0f766e','book-open',100)
) as seed(name,color,icon,ord);

create function public.sync_event_occupations(target_event_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare current_event public.events;
begin
  select * into current_event from public.events where id = target_event_id;
  delete from public.calendar_occupations where id in (
    select calendar_occupation_id from public.event_resources
    where event_id = target_event_id and calendar_occupation_id is not null
  );
  update public.event_resources set calendar_occupation_id = null where event_id = target_event_id;
  if current_event.is_blocking and current_event.publication_status = 'published' then
    with occupations as (
      insert into public.calendar_occupations
        (resource_id, occupation_type, title, starts_at, ends_at, created_by, updated_by)
      select resource_id, 'club_event'::public.occupation_type, current_event.name, current_event.starts_at,
             current_event.ends_at, current_event.updated_by, current_event.updated_by
      from public.event_resources where event_id = target_event_id
      returning id, resource_id
    )
    update public.event_resources er set calendar_occupation_id = occupations.id
    from occupations where er.event_id = target_event_id and er.resource_id = occupations.resource_id;
  end if;
end; $$;

create function public.admin_list_event_types() returns table
  (id uuid, name text, color text, icon text, display_order integer, is_active boolean)
language sql stable security definer set search_path = '' as $$
 select t.id,t.name,t.color,t.icon,t.display_order,t.is_active from public.event_types t
 where t.club_id=public.admin_current_club_id()
   and public.has_club_permission(t.club_id,'events.manage') order by t.display_order,t.name;
$$;
create function public.admin_list_event_resources() returns table (id uuid, name text)
language sql stable security definer set search_path = '' as $$
 select r.id,r.name from public.reservable_resources r
 where r.club_id=public.admin_current_club_id() and r.is_active
   and public.has_club_permission(r.club_id,'events.manage') order by r.name;
$$;
create function public.admin_save_event_type(target_name text,target_color text,target_icon text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare club uuid:=public.admin_current_club_id(); saved uuid; begin
 if not public.has_club_permission(club,'events.manage') then raise exception 'Forbidden' using errcode='42501'; end if;
 if btrim(target_name)='' or target_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Invalid event type' using errcode='22023'; end if;
 insert into public.event_types(club_id,name,color,icon,display_order)
 values(club,btrim(target_name),target_color,nullif(btrim(target_icon),''),(select coalesce(max(display_order),0)+10 from public.event_types where club_id=club))
 returning id into saved; return saved; end; $$;
create function public.admin_list_events() returns table
 (id uuid,name text,type_name text,type_color text,starts_at timestamptz,ends_at timestamptz,
  resource_names text[],responsible_name text,publication_status public.event_publication_status,
  visibility public.event_visibility,is_blocking boolean)
language sql stable security definer set search_path = '' as $$
 select e.id,e.name,t.name,coalesce(e.color,t.color),e.starts_at,e.ends_at,
   array_agg(r.name order by r.name),nullif(btrim(concat(p.first_name,' ',p.last_name)),''),
   e.publication_status,e.visibility,e.is_blocking
 from public.events e join public.event_types t on t.id=e.event_type_id
 join public.event_resources er on er.event_id=e.id join public.reservable_resources r on r.id=er.resource_id
 left join public.profiles p on p.id=e.responsible_profile_id
 where e.club_id=public.admin_current_club_id()
   and public.has_club_permission(e.club_id,'events.manage') group by e.id,t.id,p.id order by e.starts_at desc;
$$;
create function public.admin_get_event(target_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('id',e.id,'name',e.name,'event_type_id',e.event_type_id,
 'description',e.description,'responsible_profile_id',e.responsible_profile_id,'color',e.color,
 'starts_at',e.starts_at,'ends_at',e.ends_at,'is_blocking',e.is_blocking,'visibility',e.visibility,
 'publication_status',e.publication_status,'maximum_capacity',e.maximum_capacity,
 'registration_required',e.registration_required,'resource_ids',
 (select jsonb_agg(er.resource_id) from public.event_resources er where er.event_id=e.id))
 from public.events e where e.id=target_id and e.club_id=public.admin_current_club_id()
 and public.has_club_permission(e.club_id,'events.manage');
$$;

create function public.admin_save_event(payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare club uuid := public.admin_current_club_id(); saved_id uuid; resource uuid;
begin
 if not public.has_club_permission(club,'events.manage') then raise exception 'Forbidden' using errcode='42501'; end if;
 if jsonb_array_length(coalesce(payload->'resource_ids','[]'))=0 then raise exception 'Au moins un terrain est requis' using errcode='22023'; end if;
 if not exists(select 1 from public.event_types t where t.id=(payload->>'event_type_id')::uuid and t.club_id=club) then raise exception 'Invalid event type' using errcode='22023'; end if;
 saved_id := nullif(payload->>'id','')::uuid;
 if saved_id is null then
  insert into public.events(club_id,event_type_id,name,description,responsible_profile_id,color,starts_at,ends_at,is_blocking,visibility,publication_status,maximum_capacity,registration_required,archived_at,created_by,updated_by)
  values(club,(payload->>'event_type_id')::uuid,btrim(payload->>'name'),nullif(payload->>'description',''),nullif(payload->>'responsible_profile_id','')::uuid,nullif(payload->>'color',''),(payload->>'starts_at')::timestamptz,(payload->>'ends_at')::timestamptz,coalesce((payload->>'is_blocking')::boolean,false),coalesce((payload->>'visibility')::public.event_visibility,'private'),coalesce((payload->>'publication_status')::public.event_publication_status,'draft'),nullif(payload->>'maximum_capacity','')::integer,coalesce((payload->>'registration_required')::boolean,false),case when payload->>'publication_status'='archived' then now() end,auth.uid(),auth.uid()) returning id into saved_id;
 else
  update public.events set event_type_id=(payload->>'event_type_id')::uuid,name=btrim(payload->>'name'),description=nullif(payload->>'description',''),responsible_profile_id=nullif(payload->>'responsible_profile_id','')::uuid,color=nullif(payload->>'color',''),starts_at=(payload->>'starts_at')::timestamptz,ends_at=(payload->>'ends_at')::timestamptz,is_blocking=coalesce((payload->>'is_blocking')::boolean,false),visibility=(payload->>'visibility')::public.event_visibility,publication_status=(payload->>'publication_status')::public.event_publication_status,maximum_capacity=nullif(payload->>'maximum_capacity','')::integer,registration_required=coalesce((payload->>'registration_required')::boolean,false),archived_at=case when payload->>'publication_status'='archived' then coalesce(archived_at,now()) end,updated_at=now(),updated_by=auth.uid()
  where id=saved_id and club_id=club;
  if not found then raise exception 'Event not found' using errcode='P0002'; end if;
  delete from public.calendar_occupations where id in (
   select calendar_occupation_id from public.event_resources where event_id=saved_id and calendar_occupation_id is not null
  );
  delete from public.event_resources where event_id=saved_id;
 end if;
 for resource in select jsonb_array_elements_text(payload->'resource_ids')::uuid loop
  if not exists(select 1 from public.reservable_resources r where r.id=resource and r.club_id=club) then raise exception 'Invalid resource' using errcode='22023'; end if;
  insert into public.event_resources(event_id,resource_id) values(saved_id,resource);
 end loop;
 perform public.sync_event_occupations(saved_id); return saved_id;
end; $$;

create function public.admin_duplicate_event(target_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare source public.events; copy_id uuid; club uuid:=public.admin_current_club_id(); begin
 if not public.has_club_permission(club,'events.manage') then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into source from public.events where id=target_id and club_id=club;
 insert into public.events(club_id,event_type_id,name,description,responsible_profile_id,color,starts_at,ends_at,is_blocking,visibility,publication_status,maximum_capacity,registration_required,created_by,updated_by)
 values(club,source.event_type_id,source.name||' (copie)',source.description,source.responsible_profile_id,source.color,source.starts_at,source.ends_at,false,source.visibility,'draft',source.maximum_capacity,source.registration_required,auth.uid(),auth.uid()) returning id into copy_id;
 insert into public.event_resources(event_id,resource_id) select copy_id,resource_id from public.event_resources where event_id=target_id;
 return copy_id; end; $$;
create function public.admin_archive_event(target_id uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 if not public.has_club_permission(public.admin_current_club_id(),'events.manage') then raise exception 'Forbidden' using errcode='42501'; end if;
 update public.events set publication_status='archived',archived_at=now(),updated_at=now(),updated_by=auth.uid() where id=target_id and club_id=public.admin_current_club_id(); perform public.sync_event_occupations(target_id); end; $$;
create function public.admin_delete_event(target_id uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 if not public.has_club_permission(public.admin_current_club_id(),'events.manage') then raise exception 'Forbidden' using errcode='42501'; end if;
 update public.events set is_blocking=false where id=target_id and club_id=public.admin_current_club_id();
 perform public.sync_event_occupations(target_id); delete from public.events where id=target_id and club_id=public.admin_current_club_id(); end; $$;

alter table public.event_types enable row level security; alter table public.events enable row level security;
alter table public.event_resources enable row level security; alter table public.event_documents enable row level security;
create policy event_types_club_read on public.event_types for select to authenticated using (public.has_club_permission(club_id,'events.manage'));
create policy events_public_read on public.events for select to anon,authenticated using (publication_status='published' and visibility='public');
revoke all on function public.sync_event_occupations(uuid) from public;
grant execute on function public.admin_list_event_types(),public.admin_list_event_resources(),public.admin_save_event_type(text,text,text),public.admin_list_events(),public.admin_get_event(uuid),public.admin_save_event(jsonb),public.admin_duplicate_event(uuid),public.admin_archive_event(uuid),public.admin_delete_event(uuid) to authenticated;
