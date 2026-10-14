-- Show the assigned referee beside the whistle on club reservation cards.
-- This is a read-only, club-scoped RPC; existing arbitrage assignments are unchanged.
create or replace function public.list_referee_names_for_calendar(
  target_resource_id uuid,
  range_start timestamptz,
  range_end timestamptz
)
returns table(starts_at timestamptz, ends_at timestamptz, referee_name text)
language sql stable security definer
set search_path to ''
as $function$
  with allowed as (
    select r.id, r.club_id
    from public.reservable_resources r
    where r.id = target_resource_id
      and auth.uid() is not null
      and (
        exists (
          select 1
          from public.club_memberships cm
          where cm.club_id = r.club_id
            and cm.profile_id = auth.uid()
        )
        or exists (
          select 1
          from public.profiles p
          join public.club_members m
            on p.sport_player_id is not null
            and m.sport_player_id = p.sport_player_id
          where p.id = auth.uid()
            and m.club_id = r.club_id
            and m.is_active
        )
      )
  )
  select ra.starts_at, ra.ends_at,
    nullif(trim(coalesce(nullif(trim(p.display_name), ''),
      concat_ws(' ', p.first_name, p.last_name))), '') as referee_name
  from allowed a
  join public.referee_slot_assignments ra
    on ra.club_id = a.club_id and ra.resource_id = a.id
  join public.profiles p on p.id = ra.referee_profile_id
  where ra.starts_at < range_end
    and ra.ends_at > range_start
  order by ra.starts_at;
$function$;

revoke all on function public.list_referee_names_for_calendar(uuid,timestamptz,timestamptz) from public;
revoke all on function public.list_referee_names_for_calendar(uuid,timestamptz,timestamptz) from anon;
grant execute on function public.list_referee_names_for_calendar(uuid,timestamptz,timestamptz) to authenticated;
