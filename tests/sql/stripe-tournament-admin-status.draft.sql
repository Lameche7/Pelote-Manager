-- Draft: read-only tournament payment overview for authorized club managers.
create or replace function public.admin_list_tournament_stripe_payments_for_club(
  target_club_id uuid, target_tournament_id uuid
) returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  tournament_row public.tournaments%rowtype;
begin
  if auth.uid() is null or target_club_id is null or not coalesce(
    public.can_administer_club(target_club_id,'payments.manage')
    or public.can_administer_club(target_club_id,'tournaments.manage')
    or pilotoki_private.has_active_platform_lease(auth.uid(),target_club_id),false
  ) then raise exception 'Access denied' using errcode='42501'; end if;
  select * into tournament_row from public.tournaments
    where id=target_tournament_id and club_id=target_club_id;
  if not found then raise exception 'Tournament not found' using errcode='42501'; end if;
  if not exists (
    select 1 from public.club_stripe_connections c
    where c.club_id=target_club_id and c.livemode and c.charges_enabled and c.verified_at is not null
  ) and not exists (
    select 1 from public.tournament_stripe_payment_attempts p
    where p.club_id=target_club_id and p.tournament_id=target_tournament_id and p.livemode
  ) then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'team_id',t.id,'status',coalesce(p.status,'unpaid'),
      'amount_cents',coalesce(p.amount_cents,tournament_row.registration_fee_cents),
      'paid_at',p.paid_at
    ) order by t.id)
    from public.tournament_teams t
    left join lateral (
      select a.status,a.amount_cents,a.paid_at
      from public.tournament_stripe_payment_attempts a
      where a.team_id=t.id and a.club_id=target_club_id
        and a.tournament_id=target_tournament_id and a.livemode
      order by case when a.status in ('paid','disputed','processing','open','creating') then 0 else 1 end,
        a.created_at desc,a.id desc limit 1
    ) p on true
    where t.tournament_id=target_tournament_id
  ),'[]'::jsonb);
end;
$$;
revoke all on function public.admin_list_tournament_stripe_payments_for_club(uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_list_tournament_stripe_payments_for_club(uuid,uuid) to authenticated;

-- Financial totals are independent of whether Stripe is active.
-- Only verified live Stripe receipts are available at this stage.
create or replace function public.admin_get_tournament_financial_summary_for_club(
  target_club_id uuid, target_tournament_id uuid
) returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  tournament_row public.tournaments%rowtype;
  fee integer;
  result jsonb;
begin
  if auth.uid() is null or target_club_id is null or not coalesce(
    public.can_administer_club(target_club_id,'payments.manage')
    or public.can_administer_club(target_club_id,'tournaments.manage')
    or pilotoki_private.has_active_platform_lease(auth.uid(),target_club_id),false
  ) then raise exception 'Access denied' using errcode='42501'; end if;
  select * into tournament_row from public.tournaments
    where id=target_tournament_id and club_id=target_club_id;
  if not found then raise exception 'Tournament not found' using errcode='42501'; end if;
  fee := coalesce(tournament_row.registration_fee_cents,0);
  with receipts as (
    select p.team_id,sum(p.amount_cents)::bigint as received
    from public.tournament_stripe_payment_attempts p
    where p.club_id=target_club_id and p.tournament_id=target_tournament_id
      and p.livemode and p.status='paid'
    group by p.team_id
  ), series_totals as (
    select s.id,s.name,
      case when s.enabled then s.capacity else 0 end as capacity,
      count(t.id) filter(where t.status in ('pending','accepted')) as registered,
      count(t.id) filter(where t.status in ('pending','accepted') and coalesce(r.received,0)>=fee and fee>0) as paid_teams,
      count(t.id) filter(where t.status in ('pending','accepted') and fee>coalesce(r.received,0)) as unpaid_teams,
      coalesce(sum(r.received),0)::bigint as received,
      coalesce(sum(r.received) filter(where t.status in ('pending','accepted')),0)::bigint as active_received,
      coalesce(sum(greatest(fee-coalesce(r.received,0),0)) filter(where t.status in ('pending','accepted')),0)::bigint as outstanding
    from public.tournament_series s
    left join public.tournament_teams t on t.series_id=s.id and t.tournament_id=s.tournament_id
    left join receipts r on r.team_id=t.id
    where s.tournament_id=target_tournament_id
    group by s.id,s.name,s.enabled,s.capacity
  )
  select jsonb_build_object(
    'fee_cents',fee,
    'registered_teams',coalesce(sum(registered),0),
    'capacity',coalesce(sum(capacity),0),
    'paid_teams',coalesce(sum(paid_teams),0),
    'unpaid_teams',coalesce(sum(unpaid_teams),0),
    'received_cents',coalesce(sum(received),0),
    'active_received_cents',coalesce(sum(active_received),0),
    'expected_cents',coalesce(sum(registered),0)*fee,
    'maximum_cents',coalesce(sum(capacity),0)*fee,
    'outstanding_cents',coalesce(sum(outstanding),0),
    'series',coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'name',name,'registered_teams',registered,'capacity',capacity,
      'received_cents',received,'expected_cents',registered*fee,
      'maximum_cents',capacity::bigint*fee,'outstanding_cents',outstanding
    ) order by name,id),'[]'::jsonb),
    'coverage','stripe_confirmed_only'
  ) into result from series_totals;
  return result;
end;
$$;
revoke all on function public.admin_get_tournament_financial_summary_for_club(uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_get_tournament_financial_summary_for_club(uuid,uuid) to authenticated;
