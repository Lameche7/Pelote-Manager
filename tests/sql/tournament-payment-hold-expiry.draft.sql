-- Draft: release expired unpaid reservations in bounded batches.
-- No Stripe request is made here. Unknown/active attempts block release.
-- Checkout preparation and this function serialize on the same team row.
create or replace function public.release_expired_tournament_payment_holds(batch_size integer default 100)
returns integer language plpgsql security invoker set search_path='' as $$
declare
  candidate record;
  released integer:=0;
begin
  if batch_size is null or batch_size not between 1 and 500 then
    raise exception 'Invalid batch size' using errcode='22023';
  end if;
  for candidate in
    select t.id,t.tournament_id,tour.club_id
    from public.tournament_teams t
    join public.tournaments tour on tour.id=t.tournament_id
    join public.club_payment_policies p on p.club_id=tour.club_id
    where t.status='pending' and t.submitted_by is not null
      and t.registration_price_cents>0
      and p.tournament_confirmation='payment_required'
      and p.tournament_hold_place
      and t.registered_at+make_interval(hours=>p.tournament_hold_hours)<=now()
      and not exists(select 1 from public.tournament_stripe_payment_attempts a
        where a.team_id=t.id and a.livemode and a.status<>'expired')
      and not exists(select 1 from public.tournament_manual_receipts r where r.team_id=t.id)
    order by t.registered_at,t.id
    limit batch_size for update of t skip locked
  loop
    -- Recheck after acquiring the team lock; a concurrent checkout may have
    -- committed a new attempt since the candidate scan began.
    if exists(select 1 from public.tournament_stripe_payment_attempts a
        where a.team_id=candidate.id and a.livemode and a.status<>'expired')
      or exists(select 1 from public.tournament_manual_receipts r where r.team_id=candidate.id) then
      continue;
    end if;
    update public.tournament_teams t set status='withdrawn',updated_at=now()
      where t.id=candidate.id and t.status='pending'
        and exists(select 1 from public.club_payment_policies p
          where p.club_id=candidate.club_id and p.tournament_confirmation='payment_required'
            and p.tournament_hold_place
            and t.registered_at+make_interval(hours=>p.tournament_hold_hours)<=now());
    if found then released:=released+1; end if;
  end loop;
  return released;
end;
$$;
revoke all on function public.release_expired_tournament_payment_holds(integer) from public,anon,authenticated;
grant execute on function public.release_expired_tournament_payment_holds(integer) to service_role;
