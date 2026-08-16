begin;

-- Rappel automatique des matchs du jour à partir de 10 h, heure locale du tournoi.
-- Les communications restent la source unique des notifications in-app et Web Push.
-- Cette migration étend aussi les livraisons aux joueurs extérieurs qui possèdent
-- déjà un profil Pelote Manager, même s'ils ne sont pas licenciés du club organisateur.

create extension if not exists pg_cron;

alter table public.communication_deliveries
  alter column club_member_id drop not null;

alter table public.communication_deliveries
  drop constraint if exists communication_deliveries_recipient_check;

alter table public.communication_deliveries
  add constraint communication_deliveries_recipient_check
  check (club_member_id is not null or profile_id_at_publication is not null);

create unique index if not exists communication_deliveries_external_profile_unique
on public.communication_deliveries (communication_id, profile_id_at_publication)
where club_member_id is null and profile_id_at_publication is not null;

-- Un profil extérieur doit pouvoir lire et marquer comme lue une livraison qui
-- lui est explicitement adressée, sans pour autant devenir membre du club.
drop policy if exists communication_deliveries_owner_read
on public.communication_deliveries;

create policy communication_deliveries_owner_read
on public.communication_deliveries
for select
to authenticated
using (
  profile_id_at_publication = auth.uid()
  or exists (
    select 1
    from public.profiles as profile
    join public.club_members as member on member.id = profile.member_id
    where profile.id = auth.uid()
      and member.id = communication_deliveries.club_member_id
      and member.club_id = communication_deliveries.club_id
      and member.is_active
  )
);

drop policy if exists communication_deliveries_owner_update
on public.communication_deliveries;

create policy communication_deliveries_owner_update
on public.communication_deliveries
for update
to authenticated
using (
  profile_id_at_publication = auth.uid()
  or exists (
    select 1
    from public.profiles as profile
    join public.club_members as member on member.id = profile.member_id
    where profile.id = auth.uid()
      and member.id = communication_deliveries.club_member_id
      and member.club_id = communication_deliveries.club_id
      and member.is_active
  )
)
with check (
  profile_id_at_publication = auth.uid()
  or exists (
    select 1
    from public.profiles as profile
    join public.club_members as member on member.id = profile.member_id
    where profile.id = auth.uid()
      and member.id = communication_deliveries.club_member_id
      and member.club_id = communication_deliveries.club_id
      and member.is_active
  )
);

create table if not exists public.tournament_match_reminder_events (
  match_id uuid not null references public.tournament_matches(id) on delete cascade,
  team_id uuid not null references public.tournament_teams(id) on delete cascade,
  reminder_kind text not null check (reminder_kind in ('match_day_10h')),
  communication_id uuid not null references public.club_communications(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (match_id, team_id, reminder_kind),
  unique (communication_id)
);

alter table public.tournament_match_reminder_events enable row level security;
revoke all on table public.tournament_match_reminder_events
from public, anon, authenticated;

create or replace function public.publish_tournament_match_day_reminder(
  target_match_id uuid,
  target_team_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
  target_communication_id uuid;
  target_recipient_count integer := 0;
  opponent_label text;
  target_expires_at timestamptz;
begin
  select
    tournament.id as tournament_id,
    tournament.club_id,
    tournament.name as tournament_name,
    tournament.timezone as tournament_timezone,
    tournament.status as tournament_status,
    match.id as match_id,
    match.team_a_id,
    match.team_b_id,
    series.name as series_name,
    pool.display_order + 1 as pool_number,
    planning.play_date,
    planning.starts_at,
    planning.ends_at,
    resource.name as resource_name,
    resource.timezone as resource_timezone
  into target
  from public.tournament_matches as match
  join public.tournaments as tournament on tournament.id = match.tournament_id
  join public.tournament_series as series on series.id = match.series_id
  join public.tournament_pools as pool on pool.id = match.pool_id
  join public.tournament_match_planning as planning on planning.match_id = match.id
  join public.reservable_resources as resource on resource.id = planning.resource_id
  where match.id = target_match_id
    and target_team_id in (match.team_a_id, match.team_b_id)
    and tournament.status in ('planning_published', 'in_progress');

  if not found then
    return 0;
  end if;

  if target.play_date <> (now() at time zone target.tournament_timezone)::date
    or (now() at time zone target.tournament_timezone)::time < time '10:00' then
    return 0;
  end if;

  target_expires_at := public.tournament_planning_starts_at(
    target.play_date,
    target.ends_at,
    target.resource_timezone
  ) + interval '2 hours';

  if target_expires_at <= now() then
    return 0;
  end if;

  if exists (
    select 1
    from public.tournament_match_reminder_events as event
    where event.match_id = target.match_id
      and event.team_id = target_team_id
      and event.reminder_kind = 'match_day_10h'
  ) then
    return 0;
  end if;

  opponent_label := public.tournament_team_public_label(
    case
      when target.team_a_id = target_team_id then target.team_b_id
      else target.team_a_id
    end
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
    target.club_id,
    concat('Votre match aujourd’hui : ', target.tournament_name),
    concat(
      'Série ', target.series_name,
      ' – Poule ', target.pool_number,
      '. Adversaires : ', opponent_label,
      '. Terrain : ', target.resource_name,
      '. Horaire : ', to_char(target.starts_at, 'HH24:MI'), '.'
    ),
    'important',
    'draft',
    false,
    target_expires_at,
    null,
    null
  )
  returning id into target_communication_id;

  insert into public.tournament_match_reminder_events (
    match_id,
    team_id,
    reminder_kind,
    communication_id
  )
  values (
    target.match_id,
    target_team_id,
    'match_day_10h',
    target_communication_id
  )
  on conflict (match_id, team_id, reminder_kind) do nothing;

  if not found then
    delete from public.club_communications
    where id = target_communication_id;
    return 0;
  end if;

  insert into public.communication_audit_log (
    club_id,
    communication_id,
    action,
    actor_id,
    new_data
  )
  values (
    target.club_id,
    target_communication_id,
    'created',
    null,
    jsonb_build_object(
      'source', 'tournament_match_cron',
      'tournament_id', target.tournament_id,
      'match_id', target.match_id,
      'team_id', target_team_id,
      'reminder_kind', 'match_day_10h'
    )
  );

  with recipient_candidates as (
    select distinct
      member.id as club_member_id,
      coalesce(member_profile.id, external_profile.id) as profile_id,
      coalesce(
        nullif(btrim(player.email), ''),
        nullif(btrim(member.email), ''),
        nullif(btrim(member_profile.email), ''),
        nullif(btrim(external_profile.email), '')
      ) as email_snapshot
    from public.tournament_team_players as player
    left join public.club_members as member
      on member.id = player.member_id
     and member.club_id = target.club_id
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
    where player.team_id = target_team_id
      and player.tournament_id = target.tournament_id
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
    target.club_id,
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
    delete from public.tournament_match_reminder_events
    where match_id = target.match_id
      and team_id = target_team_id
      and reminder_kind = 'match_day_10h';

    delete from public.club_communications
    where id = target_communication_id;

    return 0;
  end if;

  update public.club_communications
  set
    status = 'published',
    published_at = now(),
    updated_at = now()
  where id = target_communication_id;

  insert into public.communication_audit_log (
    club_id,
    communication_id,
    action,
    actor_id,
    new_data
  )
  values (
    target.club_id,
    target_communication_id,
    'published',
    null,
    jsonb_build_object(
      'source', 'tournament_match_cron',
      'tournament_id', target.tournament_id,
      'match_id', target.match_id,
      'team_id', target_team_id,
      'reminder_kind', 'match_day_10h',
      'recipient_count', target_recipient_count
    )
  );

  return target_recipient_count;
end;
$$;

revoke all on function public.publish_tournament_match_day_reminder(uuid, uuid)
from public, anon, authenticated;

create or replace function public.publish_due_tournament_match_day_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  due record;
  published_recipients integer := 0;
begin
  for due in
    select match.id as match_id, side.team_id
    from public.tournament_matches as match
    join public.tournaments as tournament on tournament.id = match.tournament_id
    join public.tournament_match_planning as planning on planning.match_id = match.id
    join public.reservable_resources as resource on resource.id = planning.resource_id
    cross join lateral (
      values (match.team_a_id), (match.team_b_id)
    ) as side(team_id)
    where tournament.status in ('planning_published', 'in_progress')
      and planning.play_date = (now() at time zone tournament.timezone)::date
      and (now() at time zone tournament.timezone)::time >= time '10:00'
      and public.tournament_planning_starts_at(
        planning.play_date,
        planning.ends_at,
        resource.timezone
      ) + interval '2 hours' > now()
  loop
    published_recipients := published_recipients
      + public.publish_tournament_match_day_reminder(
          due.match_id,
          due.team_id
        );
  end loop;

  return published_recipients;
end;
$$;

revoke all on function public.publish_due_tournament_match_day_reminders()
from public, anon, authenticated;

-- Projection notifications : les rappels de match ouvrent directement Mes tournois.
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
    and deliveries.read_at is null
    and communications.status = 'published'
    and (communications.expires_at is null or communications.expires_at > now());
$$;

revoke all on function public.count_my_unread_notifications()
from public, anon, authenticated;
grant execute on function public.count_my_unread_notifications()
to authenticated;

create or replace function public.mark_my_notification_read(
  target_delivery_id uuid,
  target_read boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.communication_deliveries as deliveries
  set
    read_at = case
      when target_read then coalesce(deliveries.read_at, now())
      else null
    end,
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

revoke all on function public.mark_my_notification_read(uuid, boolean)
from public, anon, authenticated;
grant execute on function public.mark_my_notification_read(uuid, boolean)
to authenticated;

-- Une seule tâche globale : la fonction applique elle-même 10 h dans le fuseau
-- de chaque tournoi et l'idempotence empêche toute répétition.
select cron.unschedule(jobid)
from cron.job
where jobname = 'pelote-manager-tournament-match-day-reminders';

select cron.schedule(
  'pelote-manager-tournament-match-day-reminders',
  '*/15 * * * *',
  $$select public.publish_due_tournament_match_day_reminders();$$
);

-- Permet une mise en service le jour même après 10 h sans attendre le cron.
select public.publish_due_tournament_match_day_reminders();

commit;
