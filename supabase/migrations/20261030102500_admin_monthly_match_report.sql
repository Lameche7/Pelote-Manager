create or replace function public.admin_monthly_match_report()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  output jsonb;
begin
  if target_club_id is null then
    raise exception 'Club administrateur introuvable' using errcode='42501';
  end if;
  with months as (
    select generate_series(
      date_trunc('month', now() at time zone 'Europe/Paris') - interval '11 months',
      date_trunc('month', now() at time zone 'Europe/Paris'),
      interval '1 month'
    )::date as month_start
  ), tournaments as (
    select date_trunc('month', p.play_date)::date as month_start, count(distinct m.id) as total
    from public.tournament_matches m
    join public.tournaments t on t.id=m.tournament_id
    join public.tournament_match_results result on result.match_id=m.id and result.status::text='validated'
    join public.tournament_match_planning p on p.match_id=m.id
    where t.club_id=target_club_id and p.play_date<= (now() at time zone 'Europe/Paris')::date
      and public.has_club_permission(target_club_id,'tournaments.manage')
    group by 1
  ), championships as (
    select date_trunc('month', r.starts_at at time zone 'Europe/Paris')::date as month_start,
      count(distinct m.id) as total
    from public.championship_matches m
    join public.championship_divisions d on d.id=m.division_id
    join public.championships c on c.id=d.championship_id and c.status::text='active'
    join public.championship_teams a on a.id=m.team1_id
    join public.championship_teams b on b.id=m.team2_id
    join public.reservations r on r.championship_match_id=m.id and r.status::text='confirmed'
    join public.reservable_resources resource on resource.id=r.resource_id
      and resource.club_id=target_club_id and resource.name='Trinquet Robert Cathala'
    where m.status::text='played' and r.starts_at<=now()
      and public.has_club_permission(target_club_id,'championships.manage')
      and exists (
        select 1 from public.championship_club_links l
        where l.club_id=target_club_id and l.championship_id=d.championship_id
          and l.federation_club_id in (a.federation_club_id,b.federation_club_id)
      )
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'month', to_char(months.month_start,'YYYY-MM'),
    'tournament_matches',coalesce(tournaments.total,0),
    'championship_matches',coalesce(championships.total,0)
  ) order by months.month_start), '[]'::jsonb) into output
  from months
  left join tournaments using(month_start)
  left join championships using(month_start);
  return output;
end;
$$;
revoke all on function public.admin_monthly_match_report() from public,anon;
grant execute on function public.admin_monthly_match_report() to authenticated;
