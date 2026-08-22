begin;

-- Une fois les têtes de série figées, les paramètres et résultats qui ont servi
-- à construire le tableau ne doivent plus diverger silencieusement.

create or replace function public.prevent_tournament_final_seed_drift()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.finals_qualifier_count is distinct from new.finals_qualifier_count
    and exists (
      select 1
      from public.tournament_final_seeds as seed
      where seed.tournament_id = old.tournament_id
        and seed.series_id = old.id
    ) then
    raise exception 'Tournament qualifier count is locked after finals generation'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists tournament_series_final_seed_guard
on public.tournament_series;

create trigger tournament_series_final_seed_guard
before update of finals_qualifier_count
on public.tournament_series
for each row
execute function public.prevent_tournament_final_seed_drift();

create or replace function public.prevent_pool_result_change_after_finals_generation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_match_id uuid := coalesce(new.match_id, old.match_id);
  target_match public.tournament_matches;
begin
  select match.*
  into target_match
  from public.tournament_matches as match
  where match.id = target_match_id;

  if target_match.id is not null
    and target_match.phase = 'pools'
    and exists (
      select 1
      from public.tournament_final_seeds as seed
      where seed.tournament_id = target_match.tournament_id
        and seed.series_id = target_match.series_id
    ) then
    raise exception 'Pool results are locked after finals generation'
      using errcode = 'P0001';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists tournament_pool_result_final_seed_guard
on public.tournament_match_results;

create trigger tournament_pool_result_final_seed_guard
before update or delete
on public.tournament_match_results
for each row
execute function public.prevent_pool_result_change_after_finals_generation();

revoke all on function public.prevent_tournament_final_seed_drift()
from public, anon, authenticated;
revoke all on function public.prevent_pool_result_change_after_finals_generation()
from public, anon, authenticated;

commit;
