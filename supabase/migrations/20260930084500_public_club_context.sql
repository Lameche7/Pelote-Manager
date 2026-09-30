begin;

create or replace function public.get_public_club_branding_for_slug(
  target_slug text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'name', club.name,
        'logo_url', club.logo_url,
        'hero_image_url', club.hero_image_url,
        'primary_color', club.primary_color,
        'secondary_color', club.secondary_color,
        'accent_color', club.accent_color,
        'neutral_color', club.neutral_color,
        'slug', club.slug
      )
      from public.clubs as club
      where club.slug = nullif(btrim(target_slug), '')
      limit 1
    ),
    '{}'::jsonb
  );
$$;

revoke all on function public.get_public_club_branding_for_slug(text)
  from public, anon, authenticated;
grant execute on function public.get_public_club_branding_for_slug(text)
  to anon, authenticated;

create or replace function public.list_upcoming_events_for_club(
  target_slug text
)
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
  join public.clubs as club
    on club.id = events.club_id
   and club.slug = nullif(btrim(target_slug), '')
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

revoke all on function public.list_upcoming_events_for_club(text)
  from public, anon, authenticated;
grant execute on function public.list_upcoming_events_for_club(text)
  to anon, authenticated;

create or replace function public.list_public_tournaments_for_club(
  target_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
begin
  select club.id
  into target_club_id
  from public.clubs as club
  where club.slug = nullif(btrim(target_slug), '')
  limit 1;

  if target_club_id is null then
    return '[]'::jsonb;
  end if;

  perform public.sync_tournament_registration_states(target_club_id);

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', tournament.id,
          'name', tournament.name,
          'description', tournament.description,
          'starts_on', tournament.starts_on,
          'ends_on', tournament.ends_on,
          'registration_opens_at', tournament.registration_opens_at,
          'registration_closes_at', tournament.registration_closes_at,
          'status', tournament.status,
          'team_count', (
            select count(*)
            from public.tournament_teams as team
            where team.tournament_id = tournament.id
              and team.status = 'accepted'
          ),
          'series', (
            select coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'id', series.id,
                  'name', series.name,
                  'capacity', series.capacity,
                  'accepted_count', (
                    select count(*)
                    from public.tournament_teams as accepted_team
                    where accepted_team.series_id = series.id
                      and accepted_team.status = 'accepted'
                  ),
                  'remaining_slots', greatest(
                    series.capacity
                      - public.tournament_series_reserved_count(series.id, null),
                    0
                  )
                )
                order by series.display_order, series.name
              ),
              '[]'::jsonb
            )
            from public.tournament_series as series
            where series.tournament_id = tournament.id
              and series.enabled
          )
        )
        order by tournament.starts_on desc, tournament.name
      ),
      '[]'::jsonb
    )
    from public.tournaments as tournament
    where tournament.club_id = target_club_id
      and tournament.status not in (
        'preparation',
        'configuration',
        'cancelled'
      )
  );
end;
$$;

revoke all on function public.list_public_tournaments_for_club(text)
  from public, anon, authenticated;
grant execute on function public.list_public_tournaments_for_club(text)
  to anon, authenticated;


create or replace function public.list_my_home_banners_for_club(
  target_slug text
)
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
as $body$
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
  join public.clubs as club
    on club.id = communication.club_id
   and club.slug = nullif(btrim(target_slug), '')
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
$body$;

revoke all on function public.list_my_home_banners_for_club(text)
  from public, anon, authenticated;
grant execute on function public.list_my_home_banners_for_club(text)
  to authenticated;

commit;
