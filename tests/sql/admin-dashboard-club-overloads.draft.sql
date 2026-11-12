-- DRAFT ONLY: isolated overloads, not deployed. Source: current production RPC definitions.
-- Apply only after review and ephemeral PostgreSQL authorization tests.

CREATE OR REPLACE FUNCTION public.admin_dashboard_match_counts(target_club_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  requested_club_id uuid := target_club_id;
  tournament_count bigint := 0;
  championship_count bigint := 0;
  championship_local_count bigint := 0;
  championship_scored_count bigint := 0;
  championship_wins bigint := 0;
begin
  if auth.uid() is null or requested_club_id is null or not public.has_club_permission(requested_club_id, 'admin.dashboard.read') then
    raise exception 'Club administrateur introuvable' using errcode='42501';
  end if;
  if public.has_club_permission(requested_club_id, 'tournaments.manage') then
    select count(*) into tournament_count
    from public.tournament_matches m
    join public.tournaments t on t.id = m.tournament_id
    join public.tournament_match_results result on result.match_id = m.id
    where t.club_id = requested_club_id and result.status::text = 'validated';
  end if;
  if public.has_club_permission(requested_club_id, 'championships.manage') then
    select count(distinct m.id),
      count(distinct m.id) filter (where exists (
        select 1 from public.reservations reservation
        join public.reservable_resources resource on resource.id = reservation.resource_id
        where reservation.championship_match_id = m.id
          and reservation.status::text = 'confirmed'
          and resource.club_id = requested_club_id
          and reservation.starts_at <= now()
      )),
      count(distinct m.id) filter (where m.score_team1 is not null and m.score_team2 is not null),
      count(distinct m.id) filter (where
        (m.score_team1 > m.score_team2 and exists (select 1 from public.championship_club_links l where l.club_id = requested_club_id and l.championship_id = d.championship_id and l.federation_club_id = a.federation_club_id))
        or (m.score_team2 > m.score_team1 and exists (select 1 from public.championship_club_links l where l.club_id = requested_club_id and l.championship_id = d.championship_id and l.federation_club_id = b.federation_club_id))
      )
    into championship_count, championship_local_count, championship_scored_count, championship_wins
    from public.championship_matches m
    join public.championship_divisions d on d.id = m.division_id
    join public.championships championship on championship.id = d.championship_id
    join public.championship_teams a on a.id = m.team1_id
    join public.championship_teams b on b.id = m.team2_id
    where championship.status::text = 'active'
      and m.status::text = 'played' and exists (
      select 1 from public.championship_club_links l
      where l.club_id = requested_club_id
        and l.championship_id = d.championship_id
        and l.federation_club_id in (a.federation_club_id, b.federation_club_id)
    );
  end if;
  return jsonb_build_object(
    'tournament_matches', tournament_count,
    'championship_matches', championship_local_count,
    'championship_matches_total', championship_count,
    'championship_win_rate', case when championship_scored_count > 0 then round(100.0 * championship_wins / championship_scored_count, 1) else 0 end
  );
end;
$function$;

revoke all on function public.admin_dashboard_match_counts(uuid) from public, anon;
grant execute on function public.admin_dashboard_match_counts(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_dashboard(target_club_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  club uuid := target_club_id;
  day_start timestamptz := date_trunc('day', timezone('Europe/Paris', now())) at time zone 'Europe/Paris';
  day_end timestamptz := (date_trunc('day', timezone('Europe/Paris', now())) + interval '1 day') at time zone 'Europe/Paris';
begin
  if auth.uid() is null or club is null or not public.has_club_permission(club, 'admin.dashboard.read') then
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
        where members.club_id = club
          and members.is_active
          and public.club_member_profile_id(members.id) is not null
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
$function$;

revoke all on function public.admin_get_dashboard(uuid) from public, anon;
grant execute on function public.admin_get_dashboard(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.admin_monthly_match_report(target_club_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  requested_club_id uuid := target_club_id;
  output jsonb;
begin
  if auth.uid() is null or requested_club_id is null or not public.has_club_permission(requested_club_id, 'admin.dashboard.read') then
    raise exception 'Club administrateur introuvable' using errcode='42501';
  end if;
  with months as (
    select generate_series(
      date_trunc('month', now() at time zone 'Europe/Paris') - interval '11 months',
      date_trunc('month', now() at time zone 'Europe/Paris'),
      interval '1 month'
    )::date as month_start
  ), tournaments as (
    select date_trunc('month', p.play_date)::date as month_start, count(distinct m.id) as total
    from public.tournament_matches m
    join public.tournaments t on t.id=m.tournament_id
    join public.tournament_match_results result on result.match_id=m.id and result.status::text='validated'
    join public.tournament_match_planning p on p.match_id=m.id
    where t.club_id=requested_club_id and p.play_date<= (now() at time zone 'Europe/Paris')::date
      and public.has_club_permission(requested_club_id,'tournaments.manage')
    group by 1
  ), championships as (
    select date_trunc('month', r.starts_at at time zone 'Europe/Paris')::date as month_start,
      count(distinct m.id) as total
    from public.championship_matches m
    join public.championship_divisions d on d.id=m.division_id
    join public.championships c on c.id=d.championship_id and c.status::text='active'
    join public.championship_teams a on a.id=m.team1_id
    join public.championship_teams b on b.id=m.team2_id
    join public.reservations r on r.championship_match_id=m.id and r.status::text='confirmed'
    join public.reservable_resources resource on resource.id=r.resource_id
      and resource.club_id=requested_club_id
    where m.status::text='played' and r.starts_at<=now()
      and public.has_club_permission(requested_club_id,'championships.manage')
      and exists (
        select 1 from public.championship_club_links l
        where l.club_id=requested_club_id and l.championship_id=d.championship_id
          and l.federation_club_id in (a.federation_club_id,b.federation_club_id)
      )
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'month', to_char(months.month_start,'YYYY-MM'),
    'tournament_matches',coalesce(tournaments.total,0),
    'championship_matches',coalesce(championships.total,0)
  ) order by months.month_start), '[]'::jsonb) into output
  from months
  left join tournaments using(month_start)
  left join championships using(month_start);
  return output;
end;
$function$;

revoke all on function public.admin_monthly_match_report(uuid) from public, anon;
grant execute on function public.admin_monthly_match_report(uuid) to authenticated;

