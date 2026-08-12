begin;

-- Les événements générés automatiquement par le moteur de tournoi alimentent
-- le calendrier mais ne doivent pas encombrer l'atelier générique Évènements.
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
      nullif(btrim(concat_ws(' ', responsible_member.first_name, responsible_member.last_name)), ''),
      nullif(btrim(profile.display_name), ''),
      profile.email
    ),
    event.publication_status,
    event.visibility,
    event.is_blocking
  from public.events as event
  join public.event_types as event_type on event_type.id = event.event_type_id
  join public.event_resources as event_resource on event_resource.event_id = event.id
  join public.reservable_resources as resource on resource.id = event_resource.resource_id
  left join public.profiles as profile on profile.id = event.responsible_profile_id
  left join public.club_members as responsible_member on responsible_member.id = profile.member_id
  where event.club_id = public.admin_current_club_id()
    and public.has_club_permission(event.club_id, 'events.manage')
    and not exists (
      select 1
      from public.tournament_match_events as tournament_event
      where tournament_event.event_id = event.id
    )
  group by event.id, event_type.id, profile.id, responsible_member.id
  order by event.starts_at desc;
$$;

commit;
