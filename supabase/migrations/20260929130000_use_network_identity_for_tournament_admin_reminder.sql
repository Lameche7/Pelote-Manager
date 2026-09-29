begin;

-- PILOTOKI Network: les droits administrateur restent issus de club_memberships.
-- Seule la fiche locale utilisée pour la livraison est résolue dans le club du tournoi.
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
      on member.id = public.profile_club_member_id(
        profile.id,
        target.club_id
      )
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

commit;
