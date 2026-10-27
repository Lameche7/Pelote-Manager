begin;

-- Une notification par déprogrammation, réservée à l'arbitre du créneau.
create table public.referee_unprogram_notification_events (
  match_id uuid not null references public.tournament_matches(id) on delete cascade,
  previous_start timestamptz not null,
  primary key(match_id,previous_start),
  communication_id uuid not null unique references public.club_communications(id) on delete cascade,
  referee_profile_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.referee_unprogram_notification_events enable row level security;
revoke all on public.referee_unprogram_notification_events from public, anon, authenticated;

create function public.notify_referee_on_tournament_unprogram()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  match_start timestamptz;
  referee_id uuid;
  club uuid;
  tournament_name text;
  communication_id uuid;
  start_zone text;
begin
  select t.club_id, t.name, coalesce(r.timezone, 'Europe/Paris')
  into club, tournament_name, start_zone
  from public.tournaments t
  join public.reservable_resources r on r.id = new.previous_resource_id
  where t.id = new.tournament_id;

  match_start := (new.previous_play_date + new.previous_starts_at) at time zone start_zone;
  if match_start is null or match_start <= now() then return new; end if;

  select a.referee_profile_id into referee_id
  from public.referee_slot_assignments a
  where a.club_id = club
    and a.resource_id = new.previous_resource_id
    and a.starts_at <= match_start
    and a.ends_at > match_start
  order by a.assigned_at desc
  limit 1;

  if referee_id is null or exists (
    select 1 from public.referee_unprogram_notification_events e
    where e.match_id=new.match_id and e.previous_start=match_start
  ) then return new; end if;

  insert into public.club_communications (
    club_id,title,body,priority,status,show_on_home,published_at,expires_at
  ) values (
    club,
    'Arbitrage : partie déprogrammée',
    format('La partie du tournoi %s prévue le %s à %s a été déprogrammée. Vous n’avez plus à arbitrer cette partie à cet horaire. Motif : %s',
      tournament_name, to_char(new.previous_play_date,'DD/MM/YYYY'),
      to_char(new.previous_starts_at,'HH24:MI'), new.reason),
    'normal','published',false,now(),match_start + interval '1 day'
  ) returning id into communication_id;

  insert into public.communication_deliveries (
    communication_id, club_id, profile_id_at_publication
  ) values (communication_id,club,referee_id);

  insert into public.referee_unprogram_notification_events (
    match_id,previous_start,communication_id,referee_profile_id
  ) values (new.match_id,match_start,communication_id,referee_id);
  return new;
end;
$$;
revoke all on function public.notify_referee_on_tournament_unprogram() from public,anon,authenticated;

create trigger referee_tournament_unprogram_notification
after insert on public.tournament_unprogrammed_matches
for each row execute function public.notify_referee_on_tournament_unprogram();

commit;
