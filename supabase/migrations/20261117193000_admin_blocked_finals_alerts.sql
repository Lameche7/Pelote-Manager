-- Alert club tournament admins to known, unpublicized knockout fixtures and
-- errors in automatic progression, without altering match results or calendar.
begin;

create table if not exists public.tournament_final_auto_progress_errors (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  series_id uuid not null references public.tournament_series(id) on delete cascade,
  match_id uuid not null references public.tournament_matches(id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  occurrences integer not null default 1,
  diagnostic text not null,
  primary key (tournament_id, match_id)
);
alter table public.tournament_final_auto_progress_errors enable row level security;
revoke all on public.tournament_final_auto_progress_errors from public,anon,authenticated;

create or replace function public.after_validated_tournament_final_result_auto_progress()
returns trigger
language plpgsql security definer
set search_path=''
as $function$
declare selected_series uuid;
begin
  if new.status<>'validated' then return new; end if;
  if tg_op='UPDATE' then
    if old.status='validated' then return new; end if;
  end if;
  select m.series_id into selected_series
  from public.tournament_matches m where m.id=new.match_id
    and m.phase='finals';
  if selected_series is null then return new; end if;
  begin
    perform public.auto_progress_independent_tournament_final_branches(
      new.tournament_id,selected_series);
    delete from public.tournament_final_auto_progress_errors e
    where e.tournament_id=new.tournament_id and e.match_id=new.match_id;
  exception when others then
    insert into public.tournament_final_auto_progress_errors
      (tournament_id,series_id,match_id,diagnostic)
    values (new.tournament_id,selected_series,new.match_id,left(sqlerrm,500))
    on conflict (tournament_id,match_id)
    do update set
      last_seen_at=now(),
      occurrences=public.tournament_final_auto_progress_errors.occurrences+1,
      diagnostic=excluded.diagnostic;
    raise warning 'Automatic tournament-final progress failed for match %: %',
      new.match_id,sqlerrm;
  end;
  return new;
end;
$function$;
revoke all on function public.after_validated_tournament_final_result_auto_progress()
  from public,anon,authenticated;

create or replace function public.admin_list_blocked_tournament_finals()
returns jsonb
language plpgsql stable security definer
set search_path=''
as $function$
declare target_club uuid;
begin
  target_club:=public.admin_current_club_id();
  if (select auth.uid()) is null or target_club is null
    or not public.has_club_permission(target_club,'tournaments.manage') then
    raise exception 'Forbidden' using errcode='42501';
  end if;

  return coalesce((
    select jsonb_agg(item order by item->>'sort_key', item->>'series_name')
    from (
      select jsonb_build_object(
        'kind','unpublished',
        'tournament_id',m.tournament_id,
        'tournament_name',t.name,
        'series_name',s.name,
        'match_id',m.id,
        'round',m.final_round,
        'display_order',m.display_order,
        'team_a',public.tournament_team_public_label(m.team_a_id),
        'team_b',public.tournament_team_public_label(m.team_b_id),
        'play_date',p.play_date,
        'starts_at',p.starts_at,
        'reason',case
          when p.match_id is null then 'no_slot'
          when public.tournament_planning_starts_at(p.play_date,p.starts_at,r.timezone)<=now()
            then 'past_slot'
          when not exists (
            select 1 from public.tournament_team_availability_slots a
            where a.tournament_id=m.tournament_id and a.team_id=m.team_a_id
              and a.play_date=p.play_date and a.starts_at=p.starts_at
              and a.ends_at=p.ends_at
          ) or not exists (
            select 1 from public.tournament_team_availability_slots b
            where b.tournament_id=m.tournament_id and b.team_id=m.team_b_id
              and b.play_date=p.play_date and b.starts_at=p.starts_at
              and b.ends_at=p.ends_at
          ) then 'incompatible_availability'
          when exists (
            select 1 from public.calendar_occupations o
            where o.resource_id=p.resource_id and o.cancelled_at is null
              and o.starts_at<public.tournament_planning_starts_at(p.play_date,p.ends_at,r.timezone)
              and o.ends_at>public.tournament_planning_starts_at(p.play_date,p.starts_at,r.timezone)
          ) then 'occupied'
          when exists (
            select 1 from public.tournament_final_planning_nodes other
            where other.resource_id=p.resource_id and other.play_date=p.play_date
              and other.starts_at<p.ends_at and other.ends_at>p.starts_at
              and not (other.tournament_id=m.tournament_id and
                other.series_id=m.series_id and
                other.round_number=m.final_round_number and
                other.display_order=m.display_order)
          ) then 'occupied'
          else 'publication_pending'
        end,
        'sort_key',coalesce(to_char(p.play_date,'YYYY-MM-DD'),'0000-00-00')
      ) as item
      from public.tournament_matches m
      join public.tournaments t on t.id=m.tournament_id
        and t.club_id=target_club
        and t.status not in ('completed','archived','cancelled')
      join public.tournament_series s on s.id=m.series_id
      left join public.tournament_match_planning p on p.match_id=m.id
      left join public.reservable_resources r on r.id=p.resource_id
      left join public.tournament_match_results result on result.match_id=m.id
      where m.phase='finals'
        and m.team_a_id is not null and m.team_b_id is not null
        and (result.id is null or result.status<>'validated')
        and not exists (
          select 1 from public.tournament_match_events me
          where me.match_id=m.id
        )

      union all

      select jsonb_build_object(
        'kind','engine_error',
        'tournament_id',t.id,
        'tournament_name',t.name,
        'series_name',s.name,
        'match_id',e.match_id,
        'round',null,
        'display_order',null,
        'team_a',null,
        'team_b',null,
        'play_date',null,
        'starts_at',null,
        'reason','engine_error',
        'sort_key','0000-00-00'
      ) as item
      from public.tournament_final_auto_progress_errors e
      join public.tournaments t on t.id=e.tournament_id
        and t.club_id=target_club and t.status not in ('completed','archived','cancelled')
      join public.tournament_series s on s.id=e.series_id
      where not exists(
        select 1 from public.tournament_matches m
        join public.tournament_match_results result
          on result.match_id=m.id
        where m.id=e.match_id and result.status<>'validated'
      )
    ) issue
  ),'[]'::jsonb);
end;
$function$;
revoke all on function public.admin_list_blocked_tournament_finals()
  from public,anon;
grant execute on function public.admin_list_blocked_tournament_finals()
  to authenticated;

commit;
