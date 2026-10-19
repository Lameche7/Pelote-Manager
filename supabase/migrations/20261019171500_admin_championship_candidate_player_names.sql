-- Include both teams' players in the existing admin conversion candidate label.
-- Club-scoped conversion: no cancellation, no duplicate booking, same reservation ID.
create or replace function public.admin_championship_matches_for_reservation(target_reservation_id uuid)
returns table(match_id uuid, label text, planned_date date)
language plpgsql stable security definer set search_path = ''
as $$
declare rec public.reservations%rowtype; target_club uuid;
begin
  select * into rec from public.reservations r where r.id=target_reservation_id;
  select rr.club_id into target_club from public.reservable_resources rr where rr.id=rec.resource_id;
  if rec.id is null or not public.has_club_permission(target_club,'reservations.manage')
    or not public.has_club_permission(target_club,'championships.manage') then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  return query
  select m.id,
    concat_ws(' · ',ch.name,d.name,
      concat(
        t1.source_label, ' (',
        coalesce((select string_agg(concat_ws(' ',p.first_name,p.last_name),' / ' order by p.last_name,p.first_name)
          from public.championship_team_players tp
          join public.championship_players p on p.id=tp.player_id
          where tp.team_id=t1.id), 'joueurs non renseignés'),
        ') – ',
        t2.source_label, ' (',
        coalesce((select string_agg(concat_ws(' ',p.first_name,p.last_name),' / ' order by p.last_name,p.first_name)
          from public.championship_team_players tp
          join public.championship_players p on p.id=tp.player_id
          where tp.team_id=t2.id), 'joueurs non renseignés'),
        ')'
      )),
    coalesce(m.report_on,m.agreement_on,m.scheduled_on)
  from public.championship_matches m
  join public.championship_divisions d on d.id=m.division_id
  join public.championships ch on ch.id=d.championship_id
  join public.championship_teams t1 on t1.id=m.team1_id
  join public.championship_teams t2 on t2.id=m.team2_id
  where ch.status in ('preparation','active')
    and public.championship_club_can_manage(ch.id,target_club)
    and exists (
      select 1 from public.championship_club_links l
      join public.championship_federation_clubs fc on fc.id=l.federation_club_id
      where l.championship_id=ch.id and l.club_id=target_club
        and fc.linked_club_id=target_club and l.federation_club_id in (t1.federation_club_id,t2.federation_club_id)
    )
    and not exists (
      select 1 from public.reservations existing
      where existing.championship_match_id=m.id and existing.status in ('pending','confirmed')
        and existing.id<>rec.id
    )
  order by (coalesce(m.report_on,m.agreement_on,m.scheduled_on) =
    (rec.starts_at at time zone (select rr.timezone from public.reservable_resources rr where rr.id=rec.resource_id))::date) desc,
    coalesce(m.report_on,m.agreement_on,m.scheduled_on) desc nulls last, ch.name, d.name, t1.source_label
  limit 300;
end $$;

