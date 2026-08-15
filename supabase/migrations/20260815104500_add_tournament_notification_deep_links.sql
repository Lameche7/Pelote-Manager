begin;

-- Les notifications de tournoi restent des communications génériques, mais la
-- projection utilisateur expose une destination métier lorsqu'une communication
-- provient du cycle de vie d'un tournoi.
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
language sql
stable
security definer
set search_path = ''
as $$
  select
    deliveries.id,
    communications.id,
    communications.title,
    communications.body,
    communications.priority,
    communications.published_at,
    communications.expires_at,
    deliveries.read_at,
    communications.status = 'published'
      and (communications.expires_at is null or communications.expires_at > now()),
    case
      when tournament_event.tournament_id is not null then
        format('/tournois/%s#inscription', tournament_event.tournament_id)
      else null
    end
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
  left join public.tournament_notification_events tournament_event
    on tournament_event.communication_id = communications.id
  where profiles.id = auth.uid()
    and communications.status in ('published', 'archived')
  order by communications.published_at desc nulls last, communications.id desc;
$$;

revoke all on function public.list_my_notifications_v2()
from public, anon, authenticated;
grant execute on function public.list_my_notifications_v2()
to authenticated;

commit;
