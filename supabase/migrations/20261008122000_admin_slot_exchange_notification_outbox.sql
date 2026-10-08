-- Durable notification outbox: inserted in the same transaction as the swap.
-- Delivery is performed separately; a queued event must never be called "sent".
create table if not exists public.admin_slot_exchange_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  exchange_id uuid not null references public.admin_slot_exchange_audit(id) on delete cascade,
  reservation_id uuid references public.reservations(id),
  tournament_match_id uuid references public.tournament_matches(id),
  recipient_profile_id uuid references public.profiles(id),
  event_kind text not null default 'slot_exchanged',
  payload jsonb not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique(exchange_id, reservation_id),
  unique(exchange_id, tournament_match_id, recipient_profile_id),
  check (reservation_id is not null or tournament_match_id is not null)
);
alter table public.admin_slot_exchange_notification_outbox enable row level security;
revoke all on public.admin_slot_exchange_notification_outbox from public,anon,authenticated;

create or replace function public.queue_admin_slot_exchange_notifications()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.admin_slot_exchange_notification_outbox
    (exchange_id, reservation_id, recipient_profile_id, payload)
  select new.id, r.id, r.user_id,
    jsonb_build_object(
      'kind', 'slot_exchanged',
      'title', 'Votre réservation a changé de créneau',
      'starts_at', r.starts_at,
      'ends_at', r.ends_at,
      'resource_id', r.resource_id,
      'reservation_id', r.id
    )
  from public.calendar_occupations c
  join public.reservations r on r.id = c.reservation_id
  where c.id in (new.first_occupation_id, new.second_occupation_id)
    and r.user_id is not null
  on conflict (exchange_id, reservation_id) do nothing;
  -- Notify linked PILOTOKI accounts, including players from other clubs.
  -- Unlinked participants are deliberately excluded.
  insert into public.admin_slot_exchange_notification_outbox
    (exchange_id, tournament_match_id, recipient_profile_id, payload)
  select distinct on (moved.match_id, p.id)
    new.id, moved.match_id, p.id,
    jsonb_build_object('kind','slot_exchanged',
      'title','Votre partie de tournoi a changé de créneau',
      'tournament_match_id',moved.match_id,
      'starts_at',new.after_state -> moved.side ->> 'starts_at',
      'resource_id',new.after_state -> moved.side ->> 'resource_id')
  from (
    select side, (new.after_state -> side ->> 'tournament_match_id')::uuid as match_id
    from (values ('first'),('second')) as sides(side)
    where new.after_state -> side ->> 'kind' = 'tournament'
  ) moved
  join public.tournament_matches tm on tm.id=moved.match_id
  join public.tournament_team_players tp on tp.team_id in (tm.team_a_id,tm.team_b_id)
  join public.club_members cm on cm.id=tp.member_id
  join public.profiles p on p.sport_player_id=cm.sport_player_id
  order by moved.match_id,p.id
  on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists admin_slot_exchange_queue_notifications on public.admin_slot_exchange_audit;
create trigger admin_slot_exchange_queue_notifications
after insert on public.admin_slot_exchange_audit
for each row execute function public.queue_admin_slot_exchange_notifications();
