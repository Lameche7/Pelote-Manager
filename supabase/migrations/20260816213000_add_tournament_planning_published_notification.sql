begin;

-- Notification joueurs lors de la première publication du planning d'un tournoi.
-- Aucun backfill n'est effectué : seuls les futurs passages
-- planning_generated -> planning_published déclenchent cette notification.

alter table public.tournament_notification_events
  drop constraint if exists tournament_notification_events_event_kind_check;

alter table public.tournament_notification_events
  add constraint tournament_notification_events_event_kind_check
  check (
    event_kind in (
      'announced',
      'registrations_opened',
      'planning_published'
    )
  );

create or replace function public.publish_tournament_planning_published_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_communication_id uuid;
  target_recipient_count integer := 0;
  actor_id uuid := auth.uid();
  target_expires_at timestamptz;
begin
  if old.status is distinct from 'planning_generated'
    or new.status is distinct from 'planning_published'
  then
    return new;
  end if;

  -- La notification ne doit jamais pouvoir faire échouer la publication métier.
  begin
    if exists (
      select 1
      from public.tournament_notification_events as event
      where event.tournament_id = new.id
        and event.event_kind = 'planning_published'
    ) then
      return new;
    end if;

    target_expires_at := greatest(
      ((new.ends_on + 1)::timestamp at time zone new.timezone),
      now() + interval '1 hour'
    );

    insert into public.club_communications (
      club_id,
      title,
      body,
      priority,
      status,
      show_on_home,
      expires_at,
      created_by,
      updated_by
    )
    values (
      new.club_id,
      concat('Planning publié : ', new.name),
      concat(
        'Le planning du tournoi « ', new.name, ' » est disponible. ',
        'Consultez vos matchs, adversaires, horaires et terrains dans Mes tournois.'
      ),
      'important',
      'draft',
      false,
      target_expires_at,
      actor_id,
      actor_id
    )
    returning id into target_communication_id;

    insert into public.tournament_notification_events (
      tournament_id,
      event_kind,
      communication_id
    )
    values (
      new.id,
      'planning_published',
      target_communication_id
    )
    on conflict (tournament_id, event_kind) do nothing;

    if not found then
      delete from public.club_communications
      where id = target_communication_id;
      return new;
    end if;

    insert into public.communication_audit_log (
      club_id,
      communication_id,
      action,
      actor_id,
      new_data
    )
    values (
      new.club_id,
      target_communication_id,
      'created',
      actor_id,
      jsonb_build_object(
        'source', 'tournament',
        'tournament_id', new.id,
        'event_kind', 'planning_published'
      )
    );

    -- On cible uniquement les joueurs réellement présents dans le planning :
    -- une équipe doit participer à au moins un match du tournoi.
    with participant_players as (
      select distinct
        player.member_id,
        player.email
      from public.tournament_team_players as player
      where player.tournament_id = new.id
        and exists (
          select 1
          from public.tournament_matches as match
          where match.tournament_id = new.id
            and player.team_id in (match.team_a_id, match.team_b_id)
        )
    ),
    recipient_candidates as (
      select distinct
        member.id as club_member_id,
        coalesce(member_profile.id, external_profile.id) as profile_id,
        coalesce(
          nullif(btrim(player.email), ''),
          nullif(btrim(member.email), ''),
          nullif(btrim(member_profile.email), ''),
          nullif(btrim(external_profile.email), '')
        ) as email_snapshot
      from participant_players as player
      left join public.club_members as member
        on member.id = player.member_id
       and member.club_id = new.club_id
       and member.is_active
      left join public.profiles as member_profile
        on member_profile.member_id = member.id
      left join lateral (
        select profile.id, profile.email
        from public.profiles as profile
        where member.id is null
          and nullif(btrim(player.email), '') is not null
          and lower(btrim(profile.email)) = lower(btrim(player.email))
        order by profile.id
        limit 1
      ) as external_profile on true
    )
    insert into public.communication_deliveries (
      communication_id,
      club_id,
      club_member_id,
      profile_id_at_publication,
      email_snapshot,
      email_status
    )
    select
      target_communication_id,
      new.club_id,
      candidate.club_member_id,
      candidate.profile_id,
      candidate.email_snapshot,
      case
        when candidate.email_snapshot is null
          then 'unavailable'::public.communication_email_status
        else 'not_configured'::public.communication_email_status
      end
    from recipient_candidates as candidate
    where candidate.club_member_id is not null
       or candidate.profile_id is not null
    on conflict do nothing;

    get diagnostics target_recipient_count = row_count;

    if target_recipient_count = 0 then
      delete from public.tournament_notification_events
      where tournament_id = new.id
        and event_kind = 'planning_published';

      delete from public.club_communications
      where id = target_communication_id;

      return new;
    end if;

    update public.club_communications
    set
      status = 'published',
      published_at = now(),
      updated_at = now(),
      updated_by = actor_id
    where id = target_communication_id;

    insert into public.communication_audit_log (
      club_id,
      communication_id,
      action,
      actor_id,
      new_data
    )
    values (
      new.club_id,
      target_communication_id,
      'published',
      actor_id,
      jsonb_build_object(
        'source', 'tournament',
        'tournament_id', new.id,
        'event_kind', 'planning_published',
        'recipient_count', target_recipient_count
      )
    );
  exception
    when others then
      -- Le sous-bloc est annulé, mais la publication du planning reste valide.
      return new;
  end;

  return new;
end;
$$;

revoke all on function public.publish_tournament_planning_published_notification()
from public, anon, authenticated;

drop trigger if exists tournaments_publish_planning_notification
on public.tournaments;

create trigger tournaments_publish_planning_notification
after update of status on public.tournaments
for each row
execute function public.publish_tournament_planning_published_notification();

-- Les notifications de planning ouvrent directement l'espace tournoi du joueur.
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
      when match_event.match_id is not null then '/mon-espace/tournois'
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
    and communications.status in ('published', 'archived')
  order by communications.published_at desc nulls last, communications.id desc;
$$;

revoke all on function public.list_my_notifications_v2()
from public, anon, authenticated;
grant execute on function public.list_my_notifications_v2()
to authenticated;

commit;
