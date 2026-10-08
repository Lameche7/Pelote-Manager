-- Resolve the actual business owner of calendar occupations.
-- This is read-only and deliberately separate from the mutation RPC.
create or replace function public.admin_slot_exchange_candidates(
  target_resource_id uuid, range_start timestamptz, range_end timestamptz
)
returns table (
  occupation_id uuid, resource_id uuid, starts_at timestamptz, ends_at timestamptz,
  title text, source_kind text, exchange_supported boolean
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_profile_admin() then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;
  if range_end <= range_start or range_end - range_start > interval '31 days' then
    raise exception 'Période invalide (31 jours maximum)' using errcode = '22023';
  end if;
  return query
    select c.id, c.resource_id, c.starts_at, c.ends_at, c.title,
      case
        when c.occupation_type = 'reservation' and r.championship_match_id is not null then 'championship'
        when c.occupation_type = 'reservation' then 'reservation'
        when tme.match_id is not null then 'tournament'
        else c.occupation_type::text
      end,
      (c.starts_at > now() and (
        (c.occupation_type = 'reservation' and r.id is not null and r.status = 'confirmed')
        or (tme.match_id is not null and exists (
          select 1 from public.tournament_match_planning tp
          join public.tournament_matches tm on tm.id=tp.match_id
          join public.tournaments t on t.id=tp.tournament_id
          where tp.match_id=tme.match_id and tm.phase is distinct from 'finals'
            and t.club_id=public.admin_current_club_id()
            and tp.resource_id=c.resource_id
        ))
      )) as exchange_supported
    from public.calendar_occupations c
    left join public.reservations r on r.id = c.reservation_id
    left join public.event_resources er on er.calendar_occupation_id = c.id
    left join public.tournament_match_events tme on tme.event_id = er.event_id
    where c.cancelled_at is null
      and c.resource_id = target_resource_id
      and exists (select 1 from public.reservable_resources rr
        where rr.id=c.resource_id and rr.club_id=public.admin_current_club_id())
      and c.starts_at < range_end and c.ends_at > range_start
    order by c.starts_at, c.id;
end;
$$;
revoke all on function public.admin_slot_exchange_candidates(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.admin_slot_exchange_candidates(uuid,timestamptz,timestamptz) to authenticated;
