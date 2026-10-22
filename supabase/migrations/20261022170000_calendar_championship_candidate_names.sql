-- Atomic, club-scoped advance championship booking from a locked calendar slot.
create or replace function public.admin_calendar_championship_candidates(
  target_resource_id uuid, target_starts_at timestamptz, target_ends_at timestamptz
) returns table(match_id uuid, label text, planned_date date)
language plpgsql stable security definer set search_path = '' as $$
declare target_club uuid;
begin
  select club_id into target_club from public.reservable_resources where id=target_resource_id and is_active;
  if auth.uid() is null or target_club is null
    or not public.has_club_permission(target_club,'reservations.manage')
    or not public.has_club_permission(target_club,'championships.manage') then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  return query
  select m.id,
    concat_ws(' · ',ch.name,d.name,concat(t1.source_label,' (',coalesce(names1.players,'Joueurs non renseignés'),') – ',t2.source_label,' (',coalesce(names2.players,'Joueurs non renseignés'),')')),
    coalesce(m.report_on,m.agreement_on,m.scheduled_on)
  from public.championship_matches m
  join public.championship_divisions d on d.id=m.division_id
  join public.championships ch on ch.id=d.championship_id
  join public.championship_teams t1 on t1.id=m.team1_id
  join public.championship_teams t2 on t2.id=m.team2_id
  left join lateral (
    select string_agg(concat_ws(' ',p.first_name,p.last_name),', ' order by p.last_name,p.first_name) players
    from public.championship_team_players tp join public.championship_players p on p.id=tp.player_id
    where tp.team_id=t1.id
  ) names1 on true
  left join lateral (
    select string_agg(concat_ws(' ',p.first_name,p.last_name),', ' order by p.last_name,p.first_name) players
    from public.championship_team_players tp join public.championship_players p on p.id=tp.player_id
    where tp.team_id=t2.id
  ) names2 on true
  where ch.status in ('preparation','active')
    and public.championship_club_can_manage(ch.id,target_club)
    and exists (
      select 1 from public.championship_club_links l
      join public.championship_federation_clubs fc on fc.id=l.federation_club_id
      where l.championship_id=ch.id and l.club_id=target_club
        and fc.linked_club_id=target_club
        and l.federation_club_id in(t1.federation_club_id,t2.federation_club_id)
    )
    and not exists (
      select 1 from public.reservations r where r.championship_match_id=m.id
        and r.status in ('pending','confirmed')
    )
  order by (coalesce(m.report_on,m.agreement_on,m.scheduled_on) =
      (target_starts_at at time zone (select timezone from public.reservable_resources where id=target_resource_id))::date) desc,
    ch.name,d.name,t1.source_label
  limit 300;
end $$;


revoke all on function public.admin_calendar_championship_candidates(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.admin_calendar_championship_candidates(uuid,timestamptz,timestamptz) to authenticated;
