begin;

create table if not exists public.championship_match_club_venue_overrides (
  match_id uuid not null references public.championship_matches(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  enabled boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (match_id, club_id)
);

alter table public.championship_match_club_venue_overrides enable row level security;
revoke all on public.championship_match_club_venue_overrides from public, anon, authenticated;

create or replace function public.get_my_championship_venue_overrides()
returns table (match_id uuid, enabled boolean)
language sql stable security definer set search_path = ''
as $$
  with mine as (
    select distinct match.id as match_id, federation_club.linked_club_id as club_id
    from public.championship_matches as match
    join public.championship_team_players as team_player on team_player.team_id = match.team2_id
    join public.championship_players as player on player.id = team_player.player_id
    join public.championship_teams as my_team on my_team.id = match.team2_id
    join public.championship_federation_clubs as federation_club on federation_club.id = my_team.federation_club_id
    where player.profile_id = auth.uid()
      and player.link_status in ('claimed', 'verified')
      and federation_club.linked_club_id is not null
  )
  select mine.match_id, coalesce(venue_override.enabled, false)
  from mine
  left join public.championship_match_club_venue_overrides as venue_override
    on venue_override.match_id = mine.match_id and venue_override.club_id = mine.club_id;
$$;
revoke all on function public.get_my_championship_venue_overrides() from public, anon, authenticated;
grant execute on function public.get_my_championship_venue_overrides() to authenticated;

create or replace function public.set_my_championship_home_venue(target_match_id uuid, target_enabled boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_club_id uuid;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;

  select federation_club.linked_club_id into target_club_id
  from public.championship_matches as match
  join public.championship_team_players as team_player on team_player.team_id = match.team2_id
  join public.championship_players as player on player.id = team_player.player_id
  join public.championship_teams as my_team on my_team.id = match.team2_id
  join public.championship_federation_clubs as federation_club on federation_club.id = my_team.federation_club_id
  where match.id = target_match_id
    and player.profile_id = actor_id
    and player.link_status in ('claimed', 'verified')
    and federation_club.linked_club_id is not null
  limit 1;

  if target_club_id is null then
    raise exception 'Cette partie extérieure ne peut pas utiliser un trinquet de votre club' using errcode = '42501';
  end if;

  if not target_enabled and exists (
    select 1 from public.reservations
    where championship_match_id = target_match_id and status in ('pending', 'confirmed')
  ) then
    raise exception 'Annulez d abord la réservation active avant de retirer ce trinquet' using errcode = 'P0001';
  end if;

  insert into public.championship_match_club_venue_overrides(match_id, club_id, enabled, created_by, updated_at)
  values (target_match_id, target_club_id, target_enabled, actor_id, now())
  on conflict (match_id, club_id) do update set enabled = excluded.enabled, updated_at = now();
end;
$$;
revoke all on function public.set_my_championship_home_venue(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_my_championship_home_venue(uuid, boolean) to authenticated;

do $migration$
declare definition text; patched text;
old_fragment text := $old$
      where player.profile_id = actor_id
        and player.link_status in ('claimed', 'verified')
        and team_player.team_id = match.team1_id
    );
$old$;
new_fragment text := $new$
      where player.profile_id = actor_id
        and player.link_status in ('claimed', 'verified')
        and (
          team_player.team_id = match.team1_id
          or (
            team_player.team_id = match.team2_id
            and exists (
              select 1
              from public.championship_teams as away_team
              join public.championship_federation_clubs as away_club on away_club.id = away_team.federation_club_id
              join public.championship_match_club_venue_overrides as venue_override
                on venue_override.match_id = match.id
               and venue_override.club_id = away_club.linked_club_id
               and venue_override.enabled
              where away_team.id = match.team2_id
            )
          )
        )
    );
$new$;
begin
 definition := replace(pg_get_functiondef('public.get_my_championship_reservation_context(uuid)'::regprocedure), chr(13), '');
 if position(old_fragment in definition)=0 then raise exception 'Championship reservation context structure changed unexpectedly'; end if;
 patched := replace(definition, old_fragment, new_fragment); execute patched;
end;
$migration$;

do $migration$
declare definition text; patched text;
old_fragment text := $old$
    case
      when exists (
        select 1
        from public.championship_team_players as team_player
        join public.championship_players as player
          on player.id = team_player.player_id
        where player.profile_id = actor_id
          and player.link_status in ('claimed', 'verified')
          and team_player.team_id = match.team1_id
      ) then match.team1_id
      else null
    end,
$old$;
new_fragment text := $new$
    case
      when exists (
        select 1
        from public.championship_team_players as team_player
        join public.championship_players as player on player.id = team_player.player_id
        where player.profile_id = actor_id and player.link_status in ('claimed', 'verified')
          and team_player.team_id = match.team1_id
      ) then match.team1_id
      when exists (
        select 1
        from public.championship_team_players as team_player
        join public.championship_players as player on player.id = team_player.player_id
        join public.championship_teams as away_team on away_team.id = match.team2_id
        join public.championship_federation_clubs as away_club on away_club.id = away_team.federation_club_id
        join public.championship_match_club_venue_overrides as venue_override
          on venue_override.match_id = match.id and venue_override.club_id = away_club.linked_club_id and venue_override.enabled
        where player.profile_id = actor_id and player.link_status in ('claimed', 'verified')
          and team_player.team_id = match.team2_id
      ) then match.team2_id
      else null
    end,
$new$;
begin
 definition := replace(pg_get_functiondef('public.link_my_championship_match_reservation(uuid,uuid)'::regprocedure), chr(13), '');
 if position(old_fragment in definition)=0 then raise exception 'Championship reservation link structure changed unexpectedly'; end if;
 patched := replace(definition, old_fragment, new_fragment); execute patched;
end;
$migration$;

do $migration$
declare definition text; patched text;
old_fragment text := $old$
    case
      when exists (
        select 1
        from public.championship_team_players as team_player
        join public.championship_players as player
          on player.id = team_player.player_id
        where player.profile_id = new.user_id
          and player.link_status in ('claimed', 'verified')
          and team_player.team_id = match.team1_id
      ) then match.team1_id
      else null
    end
$old$;
new_fragment text := $new$
    case
      when exists (
        select 1
        from public.championship_team_players as team_player
        join public.championship_players as player on player.id = team_player.player_id
        where player.profile_id = new.user_id and player.link_status in ('claimed', 'verified')
          and team_player.team_id = match.team1_id
      ) then match.team1_id
      when exists (
        select 1
        from public.championship_team_players as team_player
        join public.championship_players as player on player.id = team_player.player_id
        join public.championship_teams as away_team on away_team.id = match.team2_id
        join public.championship_federation_clubs as away_club on away_club.id = away_team.federation_club_id
        join public.championship_match_club_venue_overrides as venue_override
          on venue_override.match_id = match.id and venue_override.club_id = away_club.linked_club_id and venue_override.enabled
        where player.profile_id = new.user_id and player.link_status in ('claimed', 'verified')
          and team_player.team_id = match.team2_id
      ) then match.team2_id
      else null
    end
$new$;
begin
 definition := replace(pg_get_functiondef('public.validate_championship_match_reservation()'::regprocedure), chr(13), '');
 if position(old_fragment in definition)=0 then raise exception 'Championship reservation trigger structure changed unexpectedly'; end if;
 patched := replace(definition, old_fragment, new_fragment); execute patched;
end;
$migration$;

comment on table public.championship_match_club_venue_overrides is
  'Autorise une partie officiellement extérieure à être jouée et réservée dans un club PILOTOKI sans modifier domicile/extérieur.';

commit;
