begin;
create or replace function public.admin_dashboard_match_counts()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  tournament_count bigint := 0;
  championship_count bigint := 0;
begin
  if target_club_id is null then
    raise exception 'Club administrateur introuvable' using errcode='42501';
  end if;
  if public.has_club_permission(target_club_id, 'tournaments.manage') then
    select count(*) into tournament_count
    from public.tournament_matches m
    join public.tournaments t on t.id = m.tournament_id
    where t.club_id = target_club_id;
  end if;
  if public.has_club_permission(target_club_id, 'championships.manage') then
    select count(distinct m.id) into championship_count
    from public.championship_matches m
    join public.championship_divisions d on d.id = m.division_id
    join public.championship_teams a on a.id = m.team1_id
    join public.championship_teams b on b.id = m.team2_id
    where exists (
      select 1 from public.championship_club_links l
      where l.club_id = target_club_id
        and l.championship_id = d.championship_id
        and l.federation_club_id in (a.federation_club_id, b.federation_club_id)
    );
  end if;
  return jsonb_build_object('tournament_matches',tournament_count,'championship_matches',championship_count);
end;
$$;
revoke all on function public.admin_dashboard_match_counts() from public,anon;
grant execute on function public.admin_dashboard_match_counts() to authenticated;
commit;
