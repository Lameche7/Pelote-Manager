begin;

-- A notification is a per-member delivery. Keep the source communication and
-- audit trail intact while allowing each recipient to dismiss their own copy.
alter table public.communication_deliveries
  add column if not exists deleted_at timestamptz;

create index if not exists communication_deliveries_visible_member_idx
  on public.communication_deliveries (club_member_id, created_at desc)
  where deleted_at is null;

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
    and deliveries.deleted_at is null
    and communications.status in ('published', 'archived')
  order by communications.published_at desc nulls last, communications.id desc;
$$;

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
      when reschedule_event.request_id is not null then '/mon-espace/tournois'
      when admin_event.tournament_id is not null then '/admin/tournois'
      when match_event.match_id is not null then
        format('/mon-espace/tournois?match=%s', match_event.match_id)
      when tournament_event.event_kind = 'planning_published' then '/mon-espace/tournois'
      when tournament_event.tournament_id is not null then
        format('/tournois/%s#inscription', tournament_event.tournament_id)
      else null
    end
  from public.communication_deliveries as deliveries
  join public.club_communications as communications
    on communications.id = deliveries.communication_id
   and communications.club_id = deliveries.club_id
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
      or exists (
        select 1
        from public.profiles as profile
        join public.club_members as member on member.id = profile.member_id
        where profile.id = auth.uid()
          and member.id = deliveries.club_member_id
          and member.club_id = deliveries.club_id
          and member.is_active
      )
    )
    and deliveries.deleted_at is null
    and communications.status in ('published', 'archived')
  order by communications.published_at desc nulls last, communications.id desc;
$$;

create or replace function public.count_my_unread_notifications()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.communication_deliveries as deliveries
  join public.club_communications as communications
    on communications.id = deliveries.communication_id
   and communications.club_id = deliveries.club_id
  where (
      deliveries.profile_id_at_publication = auth.uid()
      or exists (
        select 1
        from public.profiles as profile
        join public.club_members as member on member.id = profile.member_id
        where profile.id = auth.uid()
          and member.id = deliveries.club_member_id
          and member.club_id = deliveries.club_id
          and member.is_active
      )
    )
    and deliveries.deleted_at is null
    and deliveries.read_at is null
    and communications.status = 'published'
    and (communications.expires_at is null or communications.expires_at > now());
$$;

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
    and deliveries.deleted_at is null
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

create or replace function public.delete_my_notification(target_delivery_id uuid)
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
  set deleted_at = coalesce(deliveries.deleted_at, now()),
      updated_at = now()
  where deliveries.id = target_delivery_id
    and (
      deliveries.profile_id_at_publication = auth.uid()
      or exists (
        select 1
        from public.profiles as profile
        join public.club_members as member on member.id = profile.member_id
        where profile.id = auth.uid()
          and member.id = deliveries.club_member_id
          and member.club_id = deliveries.club_id
          and member.is_active
      )
    );

  if not found then
    raise exception 'Notification introuvable' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.delete_my_notification(uuid)
from public, anon;
grant execute on function public.delete_my_notification(uuid)
to authenticated;

-- When an account is linked to a club member after a championship import,
-- claim the matching historical championship identities automatically.
create or replace function public.sync_championship_player_links_from_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_row public.club_members%rowtype;
  normalized_licence text;
begin
  if new.member_id is null then
    return new;
  end if;

  select member.*
  into member_row
  from public.club_members as member
  where member.id = new.member_id;

  if member_row.id is null then
    return new;
  end if;

  normalized_licence := regexp_replace(
    coalesce(member_row.licence_number_normalized, member_row.licence_number, ''),
    '[^0-9]+',
    '',
    'g'
  );

  if normalized_licence = '' then
    return new;
  end if;

  update public.championship_players as player
  set profile_id = new.id,
      link_status = 'verified'::public.championship_player_link_status,
      linked_at = coalesce(player.linked_at, now()),
      updated_at = now()
  where (player.profile_id is null or player.profile_id = new.id)
    and regexp_replace(coalesce(player.licence_number, ''), '[^0-9]+', '', 'g') = normalized_licence
    and player.normalized_first_name = public.championship_import_normalize(member_row.first_name)
    and player.normalized_last_name = public.championship_import_normalize(member_row.last_name)
    and (
      player.profile_id is distinct from new.id
      or player.link_status <> 'verified'::public.championship_player_link_status
    );

  return new;
end;
$$;

revoke all on function public.sync_championship_player_links_from_profile()
from public, anon, authenticated;

drop trigger if exists sync_championship_player_links_after_profile_link
on public.profiles;

create trigger sync_championship_player_links_after_profile_link
after insert or update of member_id on public.profiles
for each row
execute function public.sync_championship_player_links_from_profile();

-- Backfill accounts that were linked to the club before this migration.
update public.championship_players as player
set profile_id = profile.id,
    link_status = 'verified'::public.championship_player_link_status,
    linked_at = coalesce(player.linked_at, now()),
    updated_at = now()
from public.profiles as profile
join public.club_members as member on member.id = profile.member_id
where player.profile_id is null
  and regexp_replace(coalesce(player.licence_number, ''), '[^0-9]+', '', 'g') =
      regexp_replace(
        coalesce(member.licence_number_normalized, member.licence_number, ''),
        '[^0-9]+',
        '',
        'g'
      )
  and player.normalized_first_name = public.championship_import_normalize(member.first_name)
  and player.normalized_last_name = public.championship_import_normalize(member.last_name);

-- Archived championships remain visible as history but are strictly read-only.
create or replace function public.reject_archived_championship_result_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  championship_state public.championship_status;
begin
  select championship.status
  into championship_state
  from public.championship_matches as match
  join public.championship_divisions as division
    on division.id = match.division_id
  join public.championships as championship
    on championship.id = division.championship_id
  where match.id = new.match_id;

  if championship_state = 'archived'::public.championship_status then
    raise exception 'Archived championship is read-only' using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke all on function public.reject_archived_championship_result_submission()
from public, anon, authenticated;

drop trigger if exists reject_archived_championship_result_submission
on public.championship_result_submissions;

create trigger reject_archived_championship_result_submission
before insert on public.championship_result_submissions
for each row
execute function public.reject_archived_championship_result_submission();

commit;
