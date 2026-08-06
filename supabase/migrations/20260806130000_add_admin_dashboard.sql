-- Operational Back Office dashboard, isolated by club and guarded by the
-- dedicated dashboard permission. The payload deliberately avoids customer
-- names and other personal data: detailed records remain in their own modules.
create function public.admin_get_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  club uuid := public.admin_current_club_id();
  day_start timestamptz := date_trunc('day', timezone('Europe/Paris', now())) at time zone 'Europe/Paris';
  day_end timestamptz := (date_trunc('day', timezone('Europe/Paris', now())) + interval '1 day') at time zone 'Europe/Paris';
begin
  if not public.has_club_permission(club, 'admin.dashboard.read') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'metrics', jsonb_build_object(
      'reservations_today', (
        select count(*)::integer
        from public.reservations reservations
        join public.reservable_resources resources on resources.id = reservations.resource_id
        where resources.club_id = club
          and reservations.starts_at >= day_start
          and reservations.starts_at < day_end
          and reservations.status in ('pending', 'confirmed', 'completed', 'no_show')
      ),
      'reservations_next_7_days', (
        select count(*)::integer
        from public.reservations reservations
        join public.reservable_resources resources on resources.id = reservations.resource_id
        where resources.club_id = club
          and reservations.starts_at >= now()
          and reservations.starts_at < now() + interval '7 days'
          and reservations.status in ('pending', 'confirmed')
      ),
      'active_members', (
        select count(*)::integer
        from public.club_members members
        where members.club_id = club and members.is_active
      ),
      'linked_accounts', (
        select count(*)::integer
        from public.club_members members
        join public.profiles profiles on profiles.member_id = members.id
        where members.club_id = club and members.is_active
      ),
      'payment_alerts', (
        select count(*)::integer
        from public.payments payments
        join public.reservations reservations on reservations.id = payments.reservation_id
        join public.reservable_resources resources on resources.id = reservations.resource_id
        where resources.club_id = club
          and (
            payments.status = 'failed'
            or (payments.status = 'pending' and payments.expires_at <= now())
          )
      ),
      'upcoming_closures', (
        select count(*)::integer
        from public.calendar_occupations occupations
        join public.reservable_resources resources on resources.id = occupations.resource_id
        where resources.club_id = club
          and occupations.cancelled_at is null
          and occupations.occupation_type in ('closure', 'maintenance')
          and occupations.ends_at >= now()
          and occupations.starts_at < now() + interval '30 days'
      ),
      'upcoming_events', (
        select count(*)::integer
        from public.events events
        where events.club_id = club
          and events.publication_status = 'published'
          and events.ends_at >= now()
      ),
      'active_communications', (
        select count(*)::integer
        from public.club_communications communications
        where communications.club_id = club
          and communications.status = 'published'
          and (communications.expires_at is null or communications.expires_at > now())
      ),
      'unread_deliveries', (
        select count(*)::integer
        from public.communication_deliveries deliveries
        join public.club_communications communications
          on communications.id = deliveries.communication_id
         and communications.club_id = deliveries.club_id
        where deliveries.club_id = club
          and deliveries.read_at is null
          and communications.status = 'published'
          and (communications.expires_at is null or communications.expires_at > now())
      )
    ),
    'next_reservations', (
      select coalesce(jsonb_agg(to_jsonb(next_reservation) order by next_reservation.starts_at), '[]'::jsonb)
      from (
        select reservations.id,
               resources.name as resource_name,
               reservations.starts_at,
               reservations.ends_at,
               reservations.status::text as status
        from public.reservations reservations
        join public.reservable_resources resources on resources.id = reservations.resource_id
        where resources.club_id = club
          and reservations.starts_at >= now()
          and reservations.starts_at < now() + interval '7 days'
          and reservations.status in ('pending', 'confirmed')
        order by reservations.starts_at, resources.name
        limit 6
      ) next_reservation
    ),
    'upcoming_closures', (
      select coalesce(jsonb_agg(to_jsonb(upcoming_closure) order by upcoming_closure.starts_at), '[]'::jsonb)
      from (
        select occupations.id,
               occupations.title,
               occupations.occupation_type::text as occupation_type,
               resources.name as resource_name,
               occupations.starts_at,
               occupations.ends_at
        from public.calendar_occupations occupations
        join public.reservable_resources resources on resources.id = occupations.resource_id
        where resources.club_id = club
          and occupations.cancelled_at is null
          and occupations.occupation_type in ('closure', 'maintenance')
          and occupations.ends_at >= now()
          and occupations.starts_at < now() + interval '30 days'
        order by occupations.starts_at, resources.name
        limit 5
      ) upcoming_closure
    ),
    'upcoming_events', (
      select coalesce(jsonb_agg(to_jsonb(upcoming_event) order by upcoming_event.starts_at), '[]'::jsonb)
      from (
        select events.id,
               events.name,
               event_types.name as type_name,
               coalesce(events.color, event_types.color) as color,
               events.starts_at,
               events.ends_at,
               events.visibility::text as visibility
        from public.events events
        join public.event_types event_types on event_types.id = events.event_type_id
        where events.club_id = club
          and events.publication_status = 'published'
          and events.ends_at >= now()
        order by events.starts_at, events.name
        limit 5
      ) upcoming_event
    ),
    'active_communications', (
      select coalesce(jsonb_agg(to_jsonb(active_communication) order by active_communication.published_at desc), '[]'::jsonb)
      from (
        select communications.id,
               communications.title,
               communications.priority::text as priority,
               communications.published_at,
               communications.expires_at,
               count(deliveries.id)::integer as recipient_count,
               count(deliveries.id) filter (where deliveries.read_at is null)::integer as unread_count
        from public.club_communications communications
        left join public.communication_deliveries deliveries
          on deliveries.communication_id = communications.id
         and deliveries.club_id = communications.club_id
        where communications.club_id = club
          and communications.status = 'published'
          and (communications.expires_at is null or communications.expires_at > now())
        group by communications.id
        order by communications.published_at desc
        limit 5
      ) active_communication
    ),
    'recent_activity', (
      select coalesce(jsonb_agg(to_jsonb(activity) order by activity.occurred_at desc), '[]'::jsonb)
      from (
        select 'reservation'::text as kind,
               reservations.id as entity_id,
               ('Réservation créée · ' || resources.name)::text as label,
               reservations.created_at as occurred_at,
               '/admin/reservations'::text as target_path
        from public.reservations reservations
        join public.reservable_resources resources on resources.id = reservations.resource_id
        where resources.club_id = club

        union all

        select 'event'::text,
               events.id,
               ('Évènement mis à jour · ' || events.name)::text,
               events.updated_at,
               '/admin/evenements'::text
        from public.events events
        where events.club_id = club

        union all

        select 'communication'::text,
               communications.id,
               ('Communication mise à jour · ' || communications.title)::text,
               communications.updated_at,
               '/admin/communication'::text
        from public.club_communications communications
        where communications.club_id = club

        order by occurred_at desc
        limit 8
      ) activity
    )
  );
end;
$$;

revoke all on function public.admin_get_dashboard() from public;
grant execute on function public.admin_get_dashboard() to authenticated;
