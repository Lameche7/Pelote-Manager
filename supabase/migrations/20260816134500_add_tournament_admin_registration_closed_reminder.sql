begin;

-- Un seul rappel administrateur, immédiatement après la clôture des inscriptions.
-- Le changement d'état déclenche la notification ; un cron léger garantit que
-- la clôture automatique arrive même si aucun écran du tournoi n'est ouvert.

create extension if not exists pg_cron;

create table if not exists public.tournament_admin_reminder_events (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  reminder_kind text not null check (reminder_kind in ('registrations_closed')),
  communication_id uuid not null references public.club_communications(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tournament_id, reminder_kind),
  unique (communication_id)
);

alter table public.tournament_admin_reminder_events enable row level security;
revoke all on table public.tournament_admin_reminder_events
from public, anon, authenticated;

create or replace function public.publish_tournament_registration_closed_admin_reminder(
  target_tournament_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.tournaments%rowtype;
  target_communication_id uuid;
  target_recipient_count integer := 0;
begin
  select tournament.*
  into target
  from public.tournaments as tournament
  where tournament.id = target_tournament_id
    and tournament.status = 'registrations_closed';

  if not found then
    return 0;
  end if;

  if exists (
    select 1
    from public.tournament_admin_reminder_events as event
    where event.tournament_id = target.id
      and event.reminder_kind = 'registrations_closed'
  ) then
    return 0;
  end if;

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
    concat('Inscriptions closes : ', target.name),
    concat(
      'Les inscriptions au tournoi « ', target.name,
      ' » sont maintenant closes. Pensez à finaliser les équipes, générer et valider les poules, préparer le planning puis le publier avant le début du tournoi.'
    ),
    'important',
    'draft',
    false,
    null,
    null,
    null
  )
  returning id into target_communication_id;

  insert into public.tournament_admin_reminder_events (
    tournament_id,
    reminder_kind,
    communication_id
  )
  values (
    target.id,
    'registrations_closed',
    target_communication_id
  )
  on conflict (tournament_id, reminder_kind) do nothing;

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
      'source', 'tournament_registration_closed',
      'tournament_id', target.id,
      'audience', 'tournament_admins'
    )
  );

  with recipients as (
    select distinct
      membership.profile_id,
      member.id as club_member_id,
      coalesce(
        nullif(btrim(member.email), ''),
        nullif(btrim(profile.email), '')
      ) as email_snapshot
    from public.club_memberships as membership
    join public.club_role_permissions as permission
      on permission.role_id = membership.role_id
     and permission.permission_key = 'tournaments.manage'
    join public.profiles as profile
      on profile.id = membership.profile_id
    left join public.club_members as member
      on member.id = profile.member_id
     and member.club_id = target.club_id
     and member.is_active
    where membership.club_id = target.club_id
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
    recipient.club_member_id,
    recipient.profile_id,
    recipient.email_snapshot,
    case
      when recipient.email_snapshot is null
        then 'unavailable'::public.communication_email_status
      else 'not_configured'::public.communication_email_status
    end
  from recipients as recipient
  on conflict do nothing;

  get diagnostics target_recipient_count = row_count;

  if target_recipient_count = 0 then
    delete from public.tournament_admin_reminder_events
    where tournament_id = target.id
      and reminder_kind = 'registrations_closed';

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
      'source', 'tournament_registration_closed',
      'tournament_id', target.id,
      'audience', 'tournament_admins',
      'recipient_count', target_recipient_count
    )
  );

  return target_recipient_count;
end;
$$;

revoke all on function public.publish_tournament_registration_closed_admin_reminder(uuid)
from public, anon, authenticated;

create or replace function public.notify_tournament_admins_after_registration_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status
    and new.status = 'registrations_closed' then
    begin
      perform public.publish_tournament_registration_closed_admin_reminder(new.id);
    exception when others then
      -- Une panne de notification ne doit jamais empêcher la clôture du tournoi.
      null;
    end;
  end if;

  return new;
end;
$$;

revoke all on function public.notify_tournament_admins_after_registration_close()
from public, anon, authenticated;

drop trigger if exists tournament_registration_closed_admin_reminder
on public.tournaments;

create trigger tournament_registration_closed_admin_reminder
after update of status on public.tournaments
for each row
execute function public.notify_tournament_admins_after_registration_close();

-- Force la synchronisation des clôtures arrivées à échéance sans dépendre
-- d'une visite d'un écran public ou administrateur.
create or replace function public.sync_due_tournament_registration_closures()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  due_club_id uuid;
  due_count integer := 0;
  club_due_count integer;
begin
  for due_club_id in
    select distinct tournament.club_id
    from public.tournaments as tournament
    where tournament.status = 'registrations_open'
      and tournament.registration_closes_at <= now()
  loop
    select count(*)::integer
    into club_due_count
    from public.tournaments as tournament
    where tournament.club_id = due_club_id
      and tournament.status = 'registrations_open'
      and tournament.registration_closes_at <= now();

    begin
      perform public.sync_tournament_registration_states(due_club_id);
      due_count := due_count + club_due_count;
    exception when others then
      -- Une erreur sur un club ne bloque pas les suivants ; le cron réessaiera.
      null;
    end;
  end loop;

  return due_count;
end;
$$;

revoke all on function public.sync_due_tournament_registration_closures()
from public, anon, authenticated;

-- Projection notifications : le rappel administrateur ouvre le module Tournois.
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
      when admin_event.tournament_id is not null then '/admin/tournois'
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
  left join public.tournament_admin_reminder_events as admin_event
    on admin_event.communication_id = communications.id
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

select cron.unschedule(jobid)
from cron.job
where jobname = 'pelote-manager-tournament-registration-closure-sync';

select cron.schedule(
  'pelote-manager-tournament-registration-closure-sync',
  '*/5 * * * *',
  $$select public.sync_due_tournament_registration_closures();$$
);

-- Si la migration est appliquée après une clôture déjà échue, on rattrape
-- immédiatement l'état et le rappel administrateur.
select public.sync_due_tournament_registration_closures();

commit;
