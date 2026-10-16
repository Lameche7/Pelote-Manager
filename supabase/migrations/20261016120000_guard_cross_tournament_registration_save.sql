-- Server-side guard for the current registration form, including delegated partner registration.
create or replace function public.save_my_tournament_registration_v4(
  target_tournament_id uuid,
  payload jsonb
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  selected_slot jsonb;
  partner_id uuid := nullif(payload->>'partner_member_id','')::uuid;
  team_id uuid;
begin
  -- Reject selected dates that conflict with either identified player before saving.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(payload->'availability_slots','[]'::jsonb)) slot
    join public.tournament_registration_busy_dates(target_tournament_id,partner_id) busy
      on busy.play_date = (slot->>'date')::date
  ) then
    raise exception 'Tournament cross-event busy date' using errcode = '22023';
  end if;
  team_id := public.save_my_tournament_registration_v3(target_tournament_id,payload);
  -- The registration write shares this transaction; an error rolls it back.
  if exists (
    select 1
    from public.tournament_team_availability_slots slots
    join public.tournament_registration_busy_dates(target_tournament_id,partner_id) busy
      on busy.play_date=slots.play_date
    where slots.team_id=team_id
  ) then
    raise exception 'Tournament cross-event busy date' using errcode = '22023';
  end if;
  return team_id;
end;
$$;
revoke all on function public.save_my_tournament_registration_v4(uuid,jsonb) from public, anon;
grant execute on function public.save_my_tournament_registration_v4(uuid,jsonb) to authenticated;
