-- Publish queued reservation exchange messages through the existing communication inbox.
-- Called by the administrator after a successful exchange; idempotent and transactional.
alter table public.admin_slot_exchange_notification_outbox
  add column if not exists communication_id uuid references public.club_communications(id);

create or replace function public.admin_publish_slot_exchange_notifications(target_exchange_id uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  entry record;
  target_communication_id uuid;
  target_club_id uuid;
  target_member_id uuid;
  target_email text;
  published_count integer := 0;
begin
  if not public.is_profile_admin() then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;
  if not exists (select 1 from public.admin_slot_exchange_audit a where a.id = target_exchange_id) then
    raise exception 'Échange introuvable' using errcode = '22023';
  end if;
  for entry in
    select o.*, coalesce(r.resource_id, (o.payload ->> 'resource_id')::uuid) as resource_id,
      coalesce(r.starts_at, (o.payload ->> 'starts_at')::timestamptz) as starts_at,
      r.ends_at
    from public.admin_slot_exchange_notification_outbox o
    left join public.reservations r on r.id = o.reservation_id
    where o.exchange_id = target_exchange_id and o.delivered_at is null
    order by o.id for update of o
  loop
    select rr.club_id into target_club_id
    from public.reservable_resources rr where rr.id = entry.resource_id;
    if target_club_id is null or target_club_id is distinct from public.admin_current_club_id()
      or entry.recipient_profile_id is null then
      continue;
    end if;
    select cm.id, coalesce(nullif(btrim(p.email), ''), nullif(btrim(cm.email), ''))
    into target_member_id, target_email
    from public.profiles p
    left join public.club_members cm on cm.id = p.member_id
      and cm.club_id = target_club_id and cm.is_active
    where p.id = entry.recipient_profile_id;
    -- The in-app delivery table requires a linked profile or club member.
    -- Keep email-only external players pending in the durable outbox rather
    -- than failing the entire publication transaction or marking them sent.
    if target_member_id is null and entry.recipient_profile_id is null then
      continue;
    end if;
    insert into public.club_communications
      (club_id, title, body, priority, status, show_on_home, expires_at, created_by, updated_by)
    values (
      target_club_id,
      case when entry.tournament_match_id is not null
        then 'Modification de votre partie de tournoi'
        else 'Modification de votre réservation' end,
      case when entry.tournament_match_id is not null
        then 'Votre partie de tournoi a été déplacée au '
        else 'Votre réservation a été déplacée au ' end ||
      to_char(entry.starts_at at time zone 'Europe/Paris', 'DD/MM/YYYY à HH24:MI') ||
      '. Consultez votre calendrier pour les détails.',
      'important', 'draft', false, now() + interval '14 days', auth.uid(), auth.uid()
    ) returning id into target_communication_id;
    insert into public.communication_deliveries
      (communication_id, club_id, club_member_id, profile_id_at_publication, email_snapshot, email_status)
    values (
      target_communication_id, target_club_id, target_member_id,
      entry.recipient_profile_id, target_email,
      case when target_email is null
        then 'unavailable'::public.communication_email_status
        else 'not_configured'::public.communication_email_status end
    );
    update public.club_communications
      set status = 'published', published_at = now(), updated_at = now()
      where id = target_communication_id;
    update public.admin_slot_exchange_notification_outbox
      set delivered_at = now(), communication_id = target_communication_id
      where id = entry.id;
    published_count := published_count + 1;
  end loop;
  return published_count;
end;
$$;
revoke all on function public.admin_publish_slot_exchange_notifications(uuid) from public,anon,authenticated;
grant execute on function public.admin_publish_slot_exchange_notifications(uuid) to authenticated;
