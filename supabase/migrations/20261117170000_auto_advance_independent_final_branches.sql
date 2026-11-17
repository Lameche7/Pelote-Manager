-- Advance independent knockout branches when *both* feeders are validated.
-- Enable only for Lourdes 2026 initially. Existing published matches stay locked.
begin;

alter table public.tournaments
  add column if not exists finals_auto_advance_enabled boolean not null default false;

-- Explicit pilot rollout, not a global behavior change for existing clubs.
update public.tournaments
set finals_auto_advance_enabled = true
where id = '3de17177-a915-404f-8a6e-14bf42158982'
  and club_id = '188029a8-3e6a-41cd-821f-01984a703552';

create or replace function public.auto_progress_independent_tournament_final_branches(
  target_tournament_id uuid, target_series_id uuid
)
returns integer
language plpgsql security definer
set search_path = ''
as $function$
declare
  chosen_tournament public.tournaments;
  chosen_series public.tournament_series;
  node record;
  next_match public.tournament_matches;
  qualifier_count integer;
  bracket_size integer := 1;
  direct_count integer;
  preliminary_count integer;
  seed_order integer[];
  seeds_pair integer[];
  seed_number integer;
  competitor uuid;
  entrants uuid[];
  competitor_seeds integer[];
  part integer;
  previous_round_number integer;
  previous_order integer;
  suitable record;
  tournament_event_type_id uuid;
  new_event_id uuid;
  created_count integer := 0;
begin
  -- This internal function is deliberately not executable by API roles.
  select t.* into chosen_tournament
  from public.tournaments t
  where t.id=target_tournament_id
    and t.finals_auto_advance_enabled
    and t.status in ('planning_published','in_progress')
  for update;
  if not found then return 0; end if;

  select s.* into chosen_series
  from public.tournament_series s
  where s.id=target_series_id
    and s.tournament_id=target_tournament_id and s.enabled;
  if not found then return 0; end if;

  select count(*)::integer into qualifier_count
  from public.tournament_final_seeds seeds
  where seeds.series_id=target_series_id
    and seeds.tournament_id=target_tournament_id;
  if qualifier_count<2 then return 0; end if;
  while bracket_size*2 <= qualifier_count loop
    bracket_size := bracket_size*2;
  end loop;
  preliminary_count := qualifier_count-bracket_size;
  direct_count := 2*bracket_size-qualifier_count;
  seed_order := case
    when chosen_series.finals_cross_pools and qualifier_count=6
      then array[1,3,2,4]::integer[]
    when chosen_series.finals_cross_pools and qualifier_count=8
      then array[1,8,4,5,2,7,3,6]::integer[]
    else public.tournament_final_seed_order(bracket_size)
  end;

  -- A position can be made an actual fixture without finishing the other
  -- branches of that round. Never rewrite an existing fixture or result.
  for node in
    select n.*
    from public.tournament_final_planning_nodes n
    where n.tournament_id=target_tournament_id
      and n.series_id=target_series_id
      and n.round_number>=1
      and not exists (
        select 1 from public.tournament_matches m
        where m.tournament_id=n.tournament_id
          and m.series_id=n.series_id
          and m.phase='finals'
          and m.final_round_number=n.round_number
          and m.display_order=n.display_order
      )
    order by n.round_number,n.display_order
  loop
    -- First regular round is generated at qualification time if there is no
    -- preliminary. A missing node should not be inferred from pool standings.
    if node.round_number=1 and preliminary_count=0 then continue; end if;
    entrants := array[]::uuid[];
    competitor_seeds := array[]::integer[];

    for part in 1..2 loop
      competitor := null;
      seed_number := null;
      if node.round_number=1 then
        seed_number := seed_order[node.display_order*2+part];
        if seed_number is null then exit; end if;
        if seed_number<=direct_count then
          select seeds.team_id into competitor
          from public.tournament_final_seeds seeds
          where seeds.tournament_id=target_tournament_id
            and seeds.series_id=target_series_id and seeds.seed=seed_number;
        else
          select result.winner_team_id into competitor
          from public.tournament_matches m
          join public.tournament_match_results result
            on result.match_id=m.id and result.status='validated'
          where m.tournament_id=target_tournament_id
            and m.series_id=target_series_id and m.phase='finals'
            and m.final_round_number=0 and m.final_seed_a=seed_number;
        end if;
      else
        previous_round_number := node.round_number-1;
        previous_order := node.display_order*2+(part-1);
        select result.winner_team_id into competitor
        from public.tournament_matches m
        join public.tournament_match_results result
          on result.match_id=m.id and result.status='validated'
        where m.tournament_id=target_tournament_id
          and m.series_id=target_series_id and m.phase='finals'
          and m.final_round_number=previous_round_number
          and m.display_order=previous_order;
      end if;
      if competitor is null then exit; end if;
      select seeds.seed into seed_number
      from public.tournament_final_seeds seeds
      where seeds.tournament_id=target_tournament_id
        and seeds.series_id=target_series_id
        and seeds.team_id=competitor;
      if seed_number is null then exit; end if;
      entrants := array_append(entrants,competitor);
      competitor_seeds := array_append(competitor_seeds,seed_number);
    end loop;
    if coalesce(array_length(entrants,1),0)<>2
       or entrants[1]=entrants[2] then continue; end if;

    insert into public.tournament_matches (
      tournament_id,pool_id,series_id,team_a_id,team_b_id,
      display_order,status,phase,final_round,final_round_number,
      final_seed_a,final_seed_b,updated_at
    )
    values (
      target_tournament_id,null,target_series_id,
      entrants[1],entrants[2],node.display_order,
      'to_schedule','finals',node.round,node.round_number,
      competitor_seeds[1],competitor_seeds[2],now()
    )
    on conflict do nothing
    returning * into next_match;
    if found then created_count:=created_count+1; end if;
  end loop;

  select type.id into tournament_event_type_id
  from public.event_types type
  where type.club_id=chosen_tournament.club_id
    and lower(type.name)=lower('Tournoi')
  order by type.display_order,type.id limit 1;
  if tournament_event_type_id is null then return created_count; end if;

  -- Only publish an *already scheduled* future match when both participants
  -- declared the slot and neither occupation nor conflicting match exists.
  -- Later rounds without settled opponents remain purely provisional.
  for suitable in
    select m.id,m.team_a_id,m.team_b_id,m.final_round,
      s.name series_name,s.color series_color,
      p.resource_id,p.play_date,p.starts_at,p.ends_at,
      r.timezone
    from public.tournament_matches m
    join public.tournament_match_planning p on p.match_id=m.id
    join public.tournament_series s on s.id=m.series_id
    join public.reservable_resources r on r.id=p.resource_id
    where m.tournament_id=target_tournament_id
      and m.series_id=target_series_id and m.phase='finals'
      and not exists(select 1 from public.tournament_match_events me
        where me.match_id=m.id)
      and not exists(select 1 from public.tournament_match_results res
        where res.match_id=m.id and res.status='validated')
      and public.tournament_planning_starts_at(
        p.play_date,p.starts_at,r.timezone
      )>now()
      and exists (
        select 1 from public.tournament_team_availability_slots a
        where a.tournament_id=target_tournament_id
          and a.team_id=m.team_a_id and a.play_date=p.play_date
          and a.starts_at=p.starts_at and a.ends_at=p.ends_at
      )
      and exists (
        select 1 from public.tournament_team_availability_slots a
        where a.tournament_id=target_tournament_id
          and a.team_id=m.team_b_id and a.play_date=p.play_date
          and a.starts_at=p.starts_at and a.ends_at=p.ends_at
      )
      and not exists (
        select 1 from public.calendar_occupations occ
        where occ.resource_id=p.resource_id and occ.cancelled_at is null
          and occ.starts_at<public.tournament_planning_starts_at(
            p.play_date,p.ends_at,r.timezone)
          and occ.ends_at>public.tournament_planning_starts_at(
            p.play_date,p.starts_at,r.timezone)
      )
      and not exists (
        select 1 from public.tournament_match_planning other
        where other.match_id<>m.id and other.resource_id=p.resource_id
          and other.play_date=p.play_date
          and other.starts_at<p.ends_at and other.ends_at>p.starts_at
      )
    order by p.play_date,p.starts_at,m.display_order
  loop
    insert into public.events (
      club_id,event_type_id,name,description,color,
      starts_at,ends_at,is_blocking,visibility,publication_status,
      registration_required,created_by,updated_by
    ) values (
      chosen_tournament.club_id,tournament_event_type_id,
      concat(suitable.series_name,' · ',
        public.tournament_team_public_label(suitable.team_a_id),
        ' — ',public.tournament_team_public_label(suitable.team_b_id)),
      concat(chosen_tournament.name,' · Phase finale · ',suitable.final_round),
      suitable.series_color,
      public.tournament_planning_starts_at(
        suitable.play_date,suitable.starts_at,suitable.timezone),
      public.tournament_planning_starts_at(
        suitable.play_date,suitable.ends_at,suitable.timezone),
      true,'public','published',false,auth.uid(),auth.uid()
    ) returning id into new_event_id;

    insert into public.event_resources(event_id,resource_id)
    values (new_event_id,suitable.resource_id);

    -- Existing match-event trigger sends both player notifications, with
    -- unique reminder keys preventing duplicates.
    insert into public.tournament_match_events(match_id,event_id)
    values (suitable.id,new_event_id);
    perform public.sync_event_occupations(new_event_id);
  end loop;

  return created_count;
end;
$function$;

revoke all on function public.auto_progress_independent_tournament_final_branches(uuid,uuid)
  from public,anon,authenticated;

create or replace function public.after_validated_tournament_final_result_auto_progress()
returns trigger
language plpgsql security definer
set search_path=''
as $function$
declare selected_series uuid;
begin
  if new.status<>'validated' then return new; end if;
  if tg_op='UPDATE' and old.status='validated' then return new; end if;
  select m.series_id into selected_series
  from public.tournament_matches m where m.id=new.match_id
    and m.phase='finals';
  if selected_series is null then return new; end if;
  begin
    perform public.auto_progress_independent_tournament_final_branches(
      new.tournament_id,selected_series);
  exception when others then
    -- Never invalidate a real result because a streaming calendar update failed.
    raise warning 'Automatic tournament-final progress failed for match %: %',
      new.match_id,sqlerrm;
  end;
  return new;
end;
$function$;

revoke all on function public.after_validated_tournament_final_result_auto_progress()
  from public,anon,authenticated;

drop trigger if exists tournament_final_auto_progress_after_validation
  on public.tournament_match_results;
create trigger tournament_final_auto_progress_after_validation
after insert or update of status on public.tournament_match_results
for each row execute function public.after_validated_tournament_final_result_auto_progress();

commit;
