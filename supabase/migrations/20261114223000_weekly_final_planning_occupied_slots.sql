-- Read-only view of slots occupied by non-final-stage bookings for an
-- authorized club tournament administrator. No player personal data returned.
create or replace function public.admin_get_tournament_final_external_occupied_slots(
  target_tournament_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with authorized as (
    select t.id, t.timezone, t.finals_starts_on, t.finals_ends_on
    from public.tournaments t
    where t.id = target_tournament_id
      and t.club_id = public.admin_current_club_id()
      and public.has_club_permission(t.club_id, 'tournaments.manage')
  ),
  potential as (
    select
      tr.resource_id,
      slot.play_date,
      slot.starts_at,
      slot.ends_at,
      timezone(coalesce(a.timezone, 'Europe/Paris'), slot.play_date + slot.starts_at) as begins_at,
      timezone(coalesce(a.timezone, 'Europe/Paris'), slot.play_date + slot.ends_at) as finishes_at
    from authorized a
    join public.tournament_resources tr on tr.tournament_id = a.id
    cross join lateral public.tournament_generated_slots(a.id) slot
    where slot.phase = 'finals'
      and slot.play_date between a.finals_starts_on and a.finals_ends_on
  ),
  occupied as (
    select concat(p.resource_id, '|', p.play_date, '|', p.starts_at, '|', p.ends_at) as slot_id
    from potential p
    where exists (
      select 1
      from public.reservations r
      where r.resource_id = p.resource_id
        and r.status::text in ('pending','confirmed','completed')
        and r.starts_at < p.finishes_at
        and r.ends_at > p.begins_at
    )
    or exists (
      select 1
      from public.tournament_match_planning mp
      join public.tournament_matches m on m.id = mp.match_id
      where mp.resource_id = p.resource_id
        and (m.tournament_id <> target_tournament_id or m.phase <> 'finals')
        and (mp.play_date + mp.starts_at) <
            (p.play_date + p.ends_at)
        and (mp.play_date + mp.ends_at) >
            (p.play_date + p.starts_at)
    )
  )
  select coalesce(jsonb_agg(distinct o.slot_id), '[]'::jsonb)
  from occupied o;
$function$;

revoke all on function public.admin_get_tournament_final_external_occupied_slots(uuid)
  from public, anon;
grant execute on function public.admin_get_tournament_final_external_occupied_slots(uuid)
  to authenticated;
