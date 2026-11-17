-- Schedule confirmed knockout fixtures only, using both teams' actual
-- availability. Provisional future bracket nodes no longer reserve a court.
begin;

create or replace function public.auto_assign_ready_tournament_final_slots(
  target_tournament_id uuid, target_series_id uuid
)
returns integer language plpgsql security definer set search_path=''
as $function$
declare
  target_tournament public.tournaments;
  entry record;
  candidate record;
  existing_plan public.tournament_match_planning;
  previous_fraction integer;
  current_fraction integer;
  earliest_date date;
  latest_date date;
  placed integer := 0;
begin
  select * into target_tournament from public.tournaments
  where id=target_tournament_id and finals_auto_advance_enabled
  for update;
  if not found then return 0; end if;

  for entry in
    select m.*,n.round as node_round,n.source as node_source,
      n.play_date as preferred_date,n.starts_at as preferred_start,
      n.resource_id as preferred_resource
    from public.tournament_matches m
    left join public.tournament_final_planning_nodes n
      on n.tournament_id=m.tournament_id and n.series_id=m.series_id
      and n.round_number=m.final_round_number and n.display_order=m.display_order
    where m.tournament_id=target_tournament_id and m.series_id=target_series_id
      and m.phase='finals' and m.final_round_number>0
      and m.team_a_id is not null and m.team_b_id is not null
      and not exists (
        select 1 from public.tournament_match_events link where link.match_id=m.id
      )
      and not exists (
        select 1 from public.tournament_match_results result
        where result.match_id=m.id and result.status='validated'
      )
    order by m.final_round_number,m.display_order
  loop
    select * into existing_plan from public.tournament_match_planning
    where match_id=entry.id;
    -- A human-confirmed schedule is authoritative. Never move it silently.
    if existing_plan.match_id is not null and existing_plan.source='manual' then
      continue;
    end if;

    current_fraction:=case entry.final_round
      when 'preliminary' then 4 when 'round_of_32' then 8
      when 'round_of_16' then 11 when 'quarterfinal' then 18
      when 'semifinal' then 24 when 'final' then 26 else 26 end;

    select case previous.round
      when 'preliminary' then 4 when 'round_of_32' then 8
      when 'round_of_16' then 11 when 'quarterfinal' then 18
      when 'semifinal' then 24 else 0 end
    into previous_fraction
    from public.tournament_final_planning_nodes previous
    where previous.tournament_id=entry.tournament_id
      and previous.series_id=entry.series_id
      and previous.round_number<entry.final_round_number
    order by previous.round_number desc
    limit 1;
    previous_fraction:=coalesce(previous_fraction,0);
    if target_tournament.finals_starts_on is null
       or target_tournament.finals_ends_on is null then
      continue;
    end if;

    earliest_date:=target_tournament.finals_starts_on
      + floor((target_tournament.finals_ends_on-target_tournament.finals_starts_on)
        * previous_fraction::numeric/26)::integer
      + case when previous_fraction=0 then 0 else 1 end;
    latest_date:=target_tournament.finals_starts_on
      + floor((target_tournament.finals_ends_on-target_tournament.finals_starts_on)
        * current_fraction::numeric/26)::integer;
    if entry.final_round='final' then
      earliest_date:=target_tournament.finals_ends_on;
      latest_date:=target_tournament.finals_ends_on;
    end if;

    select slot.play_date,slot.starts_at,slot.ends_at,
      selected.resource_id,resource.timezone
    into candidate
    from public.tournament_generated_slots(target_tournament_id) slot
    join public.tournament_resources selected
      on selected.tournament_id=target_tournament_id
    join public.reservable_resources resource
      on resource.id=selected.resource_id and resource.club_id=target_tournament.club_id
    where slot.phase='finals'
      and slot.play_date between earliest_date and latest_date
      and public.tournament_planning_starts_at(slot.play_date,slot.starts_at,resource.timezone)>now()
      and exists (
        select 1 from public.tournament_team_availability_slots a
        where a.tournament_id=target_tournament_id
          and a.team_id=entry.team_a_id
          and a.play_date=slot.play_date
          and a.starts_at=slot.starts_at and a.ends_at=slot.ends_at
      )
      and exists (
        select 1 from public.tournament_team_availability_slots b
        where b.tournament_id=target_tournament_id
          and b.team_id=entry.team_b_id
          and b.play_date=slot.play_date
          and b.starts_at=slot.starts_at and b.ends_at=slot.ends_at
      )
      and not exists (
        select 1 from public.calendar_occupations occ
        where occ.resource_id=selected.resource_id and occ.cancelled_at is null
          and occ.starts_at<public.tournament_planning_starts_at(
            slot.play_date,slot.ends_at,resource.timezone)
          and occ.ends_at>public.tournament_planning_starts_at(
            slot.play_date,slot.starts_at,resource.timezone)
      )
      and not exists (
        select 1 from public.tournament_match_planning other
        where other.match_id<>entry.id and other.resource_id=selected.resource_id
          and other.play_date=slot.play_date
          and other.starts_at<slot.ends_at and other.ends_at>slot.starts_at
      )
      and not exists (
        select 1 from public.tournament_match_planning other
        join public.tournament_matches other_match on other_match.id=other.match_id
        where other.match_id<>entry.id and other.tournament_id=target_tournament_id
          and (entry.team_a_id in (other_match.team_a_id,other_match.team_b_id)
            or entry.team_b_id in (other_match.team_a_id,other_match.team_b_id))
          and other.play_date=slot.play_date
          and other.starts_at<slot.ends_at and other.ends_at>slot.starts_at
      )
      and not exists (
        select 1 from public.tournament_matches previous
        join public.tournament_match_planning previous_plan on previous_plan.match_id=previous.id
        join public.reservable_resources previous_resource on previous_resource.id=previous_plan.resource_id
        where previous.tournament_id=target_tournament_id
          and previous.series_id=entry.series_id and previous.phase='finals'
          and public.tournament_final_node_depends_on(
            entry.series_id,entry.final_round_number,entry.display_order,
            previous.final_round_number,previous.display_order
          )
          and public.tournament_planning_starts_at(
            previous_plan.play_date,previous_plan.ends_at,previous_resource.timezone
          )>=public.tournament_planning_starts_at(
            slot.play_date,slot.starts_at,resource.timezone
          )
      )
      -- An unresolved node is merely a bracket position, not a reservation.
      -- Previously published match occupations remain protected above.
    order by
      case when entry.preferred_date=slot.play_date
        and entry.preferred_start=slot.starts_at
        and entry.preferred_resource=selected.resource_id then 0 else 1 end,
      slot.play_date,slot.starts_at,selected.display_order
    limit 1;
    if candidate.resource_id is null then
      delete from public.tournament_match_planning p
      where p.match_id=entry.id and p.source='generated';
      update public.tournament_matches set status='to_schedule',updated_at=now()
      where id=entry.id and status='scheduled'
        and not exists(select 1 from public.tournament_match_events e where e.match_id=entry.id);
      continue;
    end if;

    insert into public.tournament_match_planning (
      match_id,tournament_id,resource_id,play_date,starts_at,ends_at,source,updated_at
    ) values (
      entry.id,target_tournament_id,candidate.resource_id,
      candidate.play_date,candidate.starts_at,candidate.ends_at,'generated',now()
    ) on conflict(match_id) do update set
      resource_id=excluded.resource_id,play_date=excluded.play_date,
      starts_at=excluded.starts_at,ends_at=excluded.ends_at,
      source='generated',updated_at=now();

    update public.tournament_final_planning_nodes
    set resource_id=candidate.resource_id,
      play_date=candidate.play_date,starts_at=candidate.starts_at,
      ends_at=candidate.ends_at,source='generated',updated_at=now()
    where tournament_id=target_tournament_id
      and series_id=entry.series_id
      and round_number=entry.final_round_number
      and display_order=entry.display_order
      and source is distinct from 'manual';
    update public.tournament_matches set status='scheduled',updated_at=now()
    where id=entry.id and status='to_schedule';
    placed:=placed+1;
  end loop;
  return placed;
end;
$function$;
revoke all on function public.auto_assign_ready_tournament_final_slots(uuid,uuid)
from public,anon,authenticated;

-- Legacy generated placeholders from an undecided future round are released;
-- explicit manual preferences are retained internally but not displayed publicly.
update public.tournament_final_planning_nodes n
set resource_id=null,play_date=null,starts_at=null,ends_at=null,
  source=null,updated_at=now()
where n.source='generated' and n.round_number>0
  and not exists (
    select 1 from public.tournament_matches m
    where m.tournament_id=n.tournament_id and m.series_id=n.series_id
      and m.phase='finals' and m.final_round_number=n.round_number
      and m.display_order=n.display_order
  );

commit;