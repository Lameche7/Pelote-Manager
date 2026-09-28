begin;

create table if not exists public.championship_match_manual_schedules (
  match_id uuid primary key references public.championship_matches(id) on delete cascade,
  scheduled_on date not null,
  scheduled_time time not null,
  venue text,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.championship_match_manual_schedules enable row level security;
revoke all on table public.championship_match_manual_schedules from public, anon, authenticated;

create or replace function public.get_my_championship_manual_schedules()
returns table (match_id uuid, scheduled_on date, scheduled_time time, venue text)
language sql stable security definer set search_path = ''
as $$
  select schedule.match_id, schedule.scheduled_on, schedule.scheduled_time, schedule.venue
  from public.championship_match_manual_schedules schedule
  join public.championship_matches match on match.id = schedule.match_id
  where exists (
    select 1
    from public.championship_team_players team_player
    join public.championship_players player on player.id = team_player.player_id
    where player.profile_id = auth.uid()
      and player.link_status in ('claimed', 'verified')
      and team_player.team_id in (match.team1_id, match.team2_id)
  );
$$;

create or replace function public.set_my_championship_manual_schedule(
  target_match_id uuid,
  target_scheduled_on date,
  target_scheduled_time time,
  target_venue text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  match_row public.championship_matches%rowtype;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;

  select * into match_row from public.championship_matches where id = target_match_id;
  if match_row.id is null then raise exception 'Championship match not found' using errcode = 'P0002'; end if;

  if not exists (
    select 1 from public.championship_team_players team_player
    join public.championship_players player on player.id = team_player.player_id
    where player.profile_id = actor_id
      and player.link_status in ('claimed', 'verified')
      and team_player.team_id in (match_row.team1_id, match_row.team2_id)
  ) then raise exception 'Forbidden' using errcode = '42501'; end if;

  if match_row.status in ('played', 'forfeit', 'cancelled')
    or match_row.score_raw is not null
    or match_row.score_team1 is not null
    or match_row.score_team2 is not null
  then raise exception 'Match unavailable' using errcode = '22023'; end if;

  insert into public.championship_match_manual_schedules(match_id, scheduled_on, scheduled_time, venue, updated_by, updated_at)
  values(target_match_id, target_scheduled_on, target_scheduled_time, nullif(btrim(target_venue), ''), actor_id, now())
  on conflict (match_id) do update
    set scheduled_on = excluded.scheduled_on,
        scheduled_time = excluded.scheduled_time,
        venue = excluded.venue,
        updated_by = actor_id,
        updated_at = now();
end;
$$;

revoke all on function public.get_my_championship_manual_schedules() from public, anon, authenticated;
revoke all on function public.set_my_championship_manual_schedule(uuid,date,time,text) from public, anon, authenticated;
grant execute on function public.get_my_championship_manual_schedules() to authenticated;
grant execute on function public.set_my_championship_manual_schedule(uuid,date,time,text) to authenticated;

commit;
