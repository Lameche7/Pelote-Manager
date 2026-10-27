begin;

-- Alerte au retrait/déplacement d'une réservation de championnat.
-- L'affectation de l'arbitre reste liée au créneau d'origine.
create table public.referee_reservation_release_events (
  reservation_id uuid not null,
  resource_id uuid not null,
  previous_start timestamptz not null,
  referee_profile_id uuid not null,
  communication_id uuid not null unique references public.club_communications(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (reservation_id, resource_id, previous_start, referee_profile_id)
);
alter table public.referee_reservation_release_events enable row level security;
revoke all on public.referee_reservation_release_events from public,anon,authenticated;

create function public.notify_referee_on_championship_reservation_release()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  referee_id uuid;
  target_club uuid;
  target_comm uuid;
  event_title text;
  released boolean;
begin
  if old.championship_match_id is null
     or old.starts_at <= now()
     or old.status::text not in ('pending','confirmed')
  then return coalesce(new,old); end if;

  released := tg_op='DELETE';
  if tg_op='UPDATE' then
    released := new.status::text not in ('pending','confirmed')
      or new.cancelled_at is not null
      or new.starts_at is distinct from old.starts_at
      or new.ends_at is distinct from old.ends_at
      or new.resource_id is distinct from old.resource_id
      or new.championship_match_id is distinct from old.championship_match_id;
  end if;
  if not released then return coalesce(new,old); end if;

  select a.referee_profile_id,a.club_id into referee_id,target_club
  from public.referee_slot_assignments a
  where a.resource_id=old.resource_id
    and a.starts_at < old.ends_at
    and a.ends_at > old.starts_at
  order by a.assigned_at desc
  limit 1;
  if referee_id is null then return coalesce(new,old); end if;

  if exists (
    select 1 from public.referee_reservation_release_events e
    where e.reservation_id=old.id and e.resource_id=old.resource_id
      and e.previous_start=old.starts_at and e.referee_profile_id=referee_id
  ) then return coalesce(new,old); end if;

  event_title := case when tg_op='UPDATE' and new.status::text in ('pending','confirmed')
    then 'Arbitrage : partie déplacée' else 'Arbitrage : partie déprogrammée' end;

  insert into public.club_communications (
    club_id,title,body,priority,status,show_on_home,published_at,expires_at
  ) values (
    target_club,event_title,
    format('La partie de championnat prévue le %s à %s a été retirée de votre créneau d’arbitrage. Consultez le calendrier pour connaître la nouvelle programmation éventuelle.',
      to_char(old.starts_at at time zone 'Europe/Paris','DD/MM/YYYY'),
      to_char(old.starts_at at time zone 'Europe/Paris','HH24:MI')),
    'normal','published',false,now(),old.starts_at + interval '1 day'
  ) returning id into target_comm;

  insert into public.communication_deliveries (
    communication_id,club_id,profile_id_at_publication
  ) values(target_comm,target_club,referee_id);

  insert into public.referee_reservation_release_events(
    reservation_id,resource_id,previous_start,referee_profile_id,communication_id
  ) values(old.id,old.resource_id,old.starts_at,referee_id,target_comm);

  return coalesce(new,old);
end $$;
revoke all on function public.notify_referee_on_championship_reservation_release() from public,anon,authenticated;

create trigger notify_referee_reservation_release
after update or delete on public.reservations
for each row execute function public.notify_referee_on_championship_reservation_release();

commit;
