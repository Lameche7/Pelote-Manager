begin;

-- Projection publique minimale des évènements à venir.
-- La fonction ne renvoie jamais les évènements privés et décide côté serveur
-- si l'appelant peut consulter les évènements réservés aux membres.
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
          exists (
            select 1
            from public.profiles as profiles
            join public.club_members as members
              on members.id = profiles.member_id
            where profiles.id = auth.uid()
              and members.club_id = events.club_id
              and members.is_active
          )
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

revoke all on function public.list_upcoming_events() from public;
grant execute on function public.list_upcoming_events() to anon, authenticated;

commit;
