-- Ephemeral CI only: reproduce the latest historical pool constraints and helper.
alter table public.tournament_pools drop constraint tournament_pools_target_size_check;
alter table public.tournament_pools add constraint tournament_pools_target_size_check check (target_size in (3,4,5,6));
create or replace function public.tournament_pools_are_complete(
  target_tournament_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.tournaments as tournament
      where tournament.id = target_tournament_id
    )
    and not exists (
      select 1
      from public.tournament_pools as pool
      left join lateral (
        select count(*)::integer as team_count
        from public.tournament_pool_teams as assignment
        where assignment.pool_id = pool.id
      ) as stats on true
      where pool.tournament_id = target_tournament_id
        and (
          pool.target_size not in (3, 4, 5, 6)
          or stats.team_count <> pool.target_size
        )
    )
    and not exists (
      select 1
      from public.tournament_pool_teams as assignment
      join public.tournament_pools as pool on pool.id = assignment.pool_id
      join public.tournament_teams as team on team.id = assignment.team_id
      where pool.tournament_id = target_tournament_id
        and (
          team.tournament_id <> target_tournament_id
          or team.series_id <> pool.series_id
          or team.status <> 'accepted'
        )
    )
    and not exists (
      select 1
      from public.tournament_teams as team
      where team.tournament_id = target_tournament_id
        and team.status = 'accepted'
        and not exists (
          select 1
          from public.tournament_pool_teams as assignment
          join public.tournament_pools as pool on pool.id = assignment.pool_id
          where assignment.team_id = team.id
            and pool.tournament_id = target_tournament_id
        )
    )
    and not exists (
      select 1
      from public.tournament_pools as pool
      where pool.tournament_id = target_tournament_id
        and not exists (
          select 1
          from public.tournament_series as series
          where series.id = pool.series_id
            and series.tournament_id = target_tournament_id
            and series.enabled
        )
    );
$$;
revoke all on function public.tournament_pools_are_complete(uuid) from public, anon, authenticated;
