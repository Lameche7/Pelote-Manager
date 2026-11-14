-- Keep pool-phase bookings out of the automatic finals slot candidates.
-- This prevents a finals proposal from colliding with a still-programmed pool match.
create or replace function public.admin_get_tournament_finals_occupied_pool_slots(
  target_tournament_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when not exists (
      select 1
      from public.tournaments t
      where t.id = target_tournament_id
        and t.club_id = public.admin_current_club_id()
        and public.has_club_permission(t.club_id, 'tournaments.manage')
    ) then
      '[]'::jsonb
    else
      coalesce((
        select jsonb_agg(distinct concat(
          planning.resource_id, '|',
          planning.play_date, '|',
          planning.starts_at, '|',
          planning.ends_at
        ))
        from public.tournament_match_planning planning
        join public.tournament_matches match
          on match.id = planning.match_id
        where planning.tournament_id = target_tournament_id
          and match.phase = 'pools'
      ), '[]'::jsonb)
  end;
$function$;

revoke all on function public.admin_get_tournament_finals_occupied_pool_slots(uuid)
from public, anon;
grant execute on function public.admin_get_tournament_finals_occupied_pool_slots(uuid)
to authenticated;
