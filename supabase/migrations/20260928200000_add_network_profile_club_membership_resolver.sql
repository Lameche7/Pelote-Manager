begin;

-- PILOTOKI Network: resolve a profile's local membership in a given club through
-- the global sport identity. profiles.member_id remains a compatibility fallback.
create or replace function public.profile_club_member_id(
  target_profile_id uuid,
  target_club_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select member.id
  from public.profiles as profile
  join public.club_members as member
    on member.club_id = target_club_id
   and member.is_active
   and (
     (profile.sport_player_id is not null and member.sport_player_id = profile.sport_player_id)
     or member.id = profile.member_id
   )
  where profile.id = target_profile_id
  order by
    case when profile.sport_player_id is not null
      and member.sport_player_id = profile.sport_player_id then 0 else 1 end,
    member.updated_at desc,
    member.id
  limit 1;
$$;

comment on function public.profile_club_member_id(uuid, uuid) is
  'Internal PILOTOKI Network compatibility resolver: finds the local club member through profiles.sport_player_id, with profiles.member_id as a legacy fallback.';

revoke all on function public.profile_club_member_id(uuid, uuid)
from public, anon, authenticated;

-- Existing contract preserved. While there is no active-club selector yet, the
-- legacy member remains the preferred club context; the global identity is used
-- to resolve the local row in that same club.
create or replace function public.get_my_member_profile()
returns table (
  licence_number text,
  first_name text,
  last_name text,
  is_active boolean,
  season text,
  is_licensed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select profile.id, profile.member_id, profile.sport_player_id,
      legacy_member.club_id as legacy_club_id
    from public.profiles as profile
    left join public.club_members as legacy_member on legacy_member.id = profile.member_id
    where profile.id = auth.uid()
  ),
  resolved as (
    select member.*
    from actor
    join public.club_members as member
      on member.club_id = actor.legacy_club_id
     and (
       (actor.sport_player_id is not null and member.sport_player_id = actor.sport_player_id)
       or member.id = actor.member_id
     )
    order by
      case when actor.sport_player_id is not null
        and member.sport_player_id = actor.sport_player_id then 0 else 1 end
    limit 1
  )
  select
    member.licence_number,
    member.first_name,
    member.last_name,
    member.is_active,
    season.name,
    coalesce(member_season.is_licensed, false)
  from resolved as member
  left join public.club_seasons as season
    on season.club_id = member.club_id and season.is_active
  left join public.club_member_seasons as member_season
    on member_season.club_member_id = member.id
   and member_season.club_season_id = season.id;
$$;

revoke all on function public.get_my_member_profile() from public;
grant execute on function public.get_my_member_profile() to authenticated;

-- Notifications can now validate a delivery against any local club membership
-- belonging to the authenticated global player, not only profiles.member_id.
create or replace function public.list_my_notifications_v2()
returns table (
  delivery_id uuid,
  communication_id uuid,
  title text,
  body text,
  priority public.communication_priority,
  published_at timestamptz,
  expires_at timestamptz,
  read_at timestamptz,
  is_active boolean,
  action_url text
)
language sql stable security definer set search_path = ''
as $$
  select
    deliveries.id, communications.id, communications.title, communications.body,
    communications.priority, communications.published_at, communications.expires_at,
    deliveries.read_at,
    communications.status = 'published'
      and (communications.expires_at is null or communications.expires_at > now()),
    case
      when championship_reminder.match_id is not null then
        format('/mon-espace/championnats?match=%s', championship_reminder.match_id)
      when payment_request.payment_id is not null then
        format('/reservations/paiement-part?paymentId=%s', payment_request.payment_id)
      when permanent_slot_reminder.occurrence_id is not null then '/mon-espace/creneaux-permanents'
      when reschedule_event.request_id is not null then '/mon-espace/tournois'
      when admin_event.tournament_id is not null then '/admin/tournois'
      when match_event.match_id is not null then format('/mon-espace/tournois?match=%s', match_event.match_id)
      when tournament_event.event_kind = 'planning_published' then '/mon-espace/tournois'
      when tournament_event.tournament_id is not null then format('/tournois/%s#inscription', tournament_event.tournament_id)
      when communications.title like 'Créneau libéré · %' then '/reservations'
      else null
    end
  from public.communication_deliveries as deliveries
  join public.club_communications as communications
    on communications.id = deliveries.communication_id and communications.club_id = deliveries.club_id
  left join public.championship_match_reminder_events as championship_reminder
    on championship_reminder.communication_id = communications.id
  left join public.reservation_payment_notification_events as payment_request
    on payment_request.communication_id = communications.id
  left join public.permanent_slot_reminder_events as permanent_slot_reminder
    on permanent_slot_reminder.communication_id = communications.id
  left join public.tournament_notification_events as tournament_event
    on tournament_event.communication_id = communications.id
  left join public.tournament_match_reminder_events as match_event
    on match_event.communication_id = communications.id
  left join public.tournament_admin_reminder_events as admin_event
    on admin_event.communication_id = communications.id
  left join public.tournament_reschedule_notification_events as reschedule_event
    on reschedule_event.communication_id = communications.id
  where (
      deliveries.profile_id_at_publication = auth.uid()
      or (
        deliveries.club_member_id is not null
        and deliveries.club_member_id =
          public.profile_club_member_id(auth.uid(), deliveries.club_id)
      )
    )
    and deliveries.deleted_at is null
    and communications.status in ('published', 'archived')
  order by communications.published_at desc nulls last, communications.id desc;
$$;

revoke all on function public.list_my_notifications_v2() from public, anon;
grant execute on function public.list_my_notifications_v2() to authenticated;

commit;
