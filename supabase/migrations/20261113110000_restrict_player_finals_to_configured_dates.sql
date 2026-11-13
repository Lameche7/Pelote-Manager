begin;

-- Restrict edits to configured finals dates while preserving historical selections.
-- Keep tournament registration closed while allowing the submitting player
-- to maintain final-stage availability on an existing active team.
create or replace function public.update_my_tournament_finals_availability(
  target_tournament_id uuid,
  selected_slots jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  registration jsonb;
  team_id uuid;
  finals_start date;
  finals_end date;
  minimum_finals integer;
  item jsonb;
  count_selected integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  registration := public.get_my_tournament_registration_v3(target_tournament_id);
  if registration is null or registration->>'status' not in ('pending', 'accepted') then
    raise exception 'No active tournament registration' using errcode = '42501';
  end if;
  team_id := (registration->>'id')::uuid;

  select t.finals_starts_on, t.finals_ends_on, t.minimum_finals_availability_slots
    into finals_start, finals_end, minimum_finals
    from public.tournaments t where t.id = target_tournament_id
    for update;
  if finals_start is null or finals_end is null then
    raise exception 'Tournament finals are not configured' using errcode = '22023';
  end if;
  if jsonb_typeof(selected_slots) is distinct from 'array' then
    raise exception 'Tournament availability slots are invalid' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(selected_slots)
  loop
    if coalesce(item->>'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or coalesce(item->>'starts_at', '') !~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$'
      or coalesce(item->>'ends_at', '') !~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$'
      or (item->>'date')::date not between finals_start and finals_end
      or not exists (
        select 1
        from public.tournament_generated_slots(target_tournament_id) slot
        where slot.phase = 'finals'
          and slot.play_date = (item->>'date')::date
          and slot.starts_at = (item->>'starts_at')::time
          and slot.ends_at = (item->>'ends_at')::time
      ) then
      raise exception 'Tournament availability slots are invalid' using errcode = '22023';
    end if;
    count_selected := count_selected + 1;
  end loop;
  if count_selected <> (
    select count(distinct concat(value->>'date','|',value->>'starts_at','|',value->>'ends_at'))
    from jsonb_array_elements(selected_slots)
  ) then
    raise exception 'Duplicate tournament availability slots' using errcode = '22023';
  end if;
  if count_selected < coalesce(minimum_finals, 0) then
    raise exception 'Tournament finals availability minimum not reached' using errcode = '22023';
  end if;

  -- Reject newly selected days already occupied by either identified player
  -- in another Pilotoki tournament. Existing selections remain grandfathered.
  if exists (
    select 1 from jsonb_array_elements(selected_slots) candidate
    where not exists (
      select 1 from public.tournament_team_availability_slots previous
      where previous.team_id = team_id
        and previous.play_date = (candidate->>'date')::date
        and previous.starts_at = (candidate->>'starts_at')::time
        and previous.ends_at = (candidate->>'ends_at')::time
    )
    and (
      exists (
        select 1 from public.tournament_registration_busy_dates(target_tournament_id, null) busy
        where busy.play_date = (candidate->>'date')::date
      )
      or exists (
        select 1 from public.tournament_team_players teammate
        join public.tournament_registration_busy_dates(
          target_tournament_id, teammate.member_id
        ) busy on busy.play_date = (candidate->>'date')::date
        where teammate.team_id = team_id and teammate.member_id is not null
      )
    )
  ) then
    raise exception 'Tournament cross-event busy date' using errcode = '22023';
  end if;

  -- Never alter pool availability, or out-of-window selections kept when dates changed.
  delete from public.tournament_team_availability_slots a
  where a.team_id = team_id
    and a.tournament_id = target_tournament_id
    and a.play_date between finals_start and finals_end
    and exists (
      select 1 from public.tournament_generated_slots(target_tournament_id) generated
      where generated.phase = 'finals'
        and generated.play_date = a.play_date
        and generated.starts_at = a.starts_at
        and generated.ends_at = a.ends_at
    );

  insert into public.tournament_team_availability_slots
    (team_id, tournament_id, play_date, starts_at, ends_at)
  select team_id, target_tournament_id,
         (value->>'date')::date, (value->>'starts_at')::time, (value->>'ends_at')::time
  from jsonb_array_elements(selected_slots)
  on conflict (team_id, play_date, starts_at, ends_at) do nothing;

  perform public.assert_tournament_team_finals_availability(team_id);

  insert into public.tournament_audit_log
    (tournament_id, action, payload, created_by)
  values (target_tournament_id, 'finals_availability_updated_by_player',
          jsonb_build_object('team_id', team_id, 'slot_count', count_selected),
          auth.uid());
end;
$$;

revoke all on function public.update_my_tournament_finals_availability(uuid,jsonb)
from public, anon;
grant execute on function public.update_my_tournament_finals_availability(uuid,jsonb)
to authenticated;

commit;
