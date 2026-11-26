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
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'team_id',t.id,
      'status',case
        when p.status='disputed' then 'disputed'
        when t.registration_price_cents=0 then 'free'
        when balances.received>=t.registration_price_cents then 'paid'
        when p.status in ('creating','open','processing') then 'processing'
        when balances.received>0 then 'partial'
        else coalesce(p.status,'unpaid') end,
      'amount_cents',t.registration_price_cents,
      'received_cents',balances.received,
      'remaining_cents',greatest(t.registration_price_cents-balances.received,0),
      'paid_at',p.paid_at,
      'can_record_manual',t.status in ('pending','accepted')
        and balances.received<t.registration_price_cents
        and coalesce(p.status,'unpaid') not in ('creating','open','processing','disputed')
        and coalesce(public.can_administer_club(target_club_id,'payments.manage')
          or pilotoki_private.has_active_platform_lease(auth.uid(),target_club_id),false),
      'manual_methods',to_jsonb(array_remove(array[
        case when policy.cash_enabled then 'cash' end,
        case when policy.cheque_enabled then 'cheque' end,
        case when policy.bank_transfer_enabled then 'bank_transfer' end
      ]::text[],null))
    ) order by t.id)
    from public.tournament_teams t
    left join public.club_payment_policies policy on policy.club_id=target_club_id
    left join lateral (
      select a.status,a.amount_cents,a.paid_at
      from public.tournament_stripe_payment_attempts a
      where a.team_id=t.id and a.club_id=target_club_id
        and a.tournament_id=target_tournament_id and a.livemode
      order by case when a.status in ('paid','disputed','processing','open','creating') then 0 else 1 end,
        a.created_at desc,a.id desc limit 1
    ) p on true
    cross join lateral (
      select coalesce((select sum(m.amount_cents) from public.tournament_manual_receipts m
        where m.team_id=t.id and m.club_id=target_club_id and m.tournament_id=target_tournament_id),0)
        +coalesce((select sum(a.amount_cents) from public.tournament_stripe_payment_attempts a
        where a.team_id=t.id and a.club_id=target_club_id and a.tournament_id=target_tournament_id
          and a.livemode and a.status='paid'),0) as received
    ) balances
    where t.tournament_id=target_tournament_id
  ),'[]'::jsonb);
end;
$$;
revoke all on function public.admin_list_tournament_stripe_payments_for_club(uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_list_tournament_stripe_payments_for_club(uuid,uuid) to authenticated;

-- Financial totals are independent of whether Stripe is active.
-- Include verified live Stripe receipts and confirmed manual receipts.
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
  with receipt_lines as (
    select p.team_id,p.amount_cents
    from public.tournament_stripe_payment_attempts p
    where p.club_id=target_club_id and p.tournament_id=target_tournament_id
      and p.livemode and p.status='paid'
    union all
    select m.team_id,m.amount_cents from public.tournament_manual_receipts m
    where m.club_id=target_club_id and m.tournament_id=target_tournament_id
  ), receipts as (
    select team_id,sum(amount_cents)::bigint as received from receipt_lines group by team_id
  ), series_totals as (
    select s.id,s.name,
      case when s.enabled then s.capacity else 0 end as capacity,
      count(t.id) filter(where t.status in ('pending','accepted')) as registered,
      count(t.id) filter(where t.status in ('pending','accepted') and coalesce(r.received,0)>=t.registration_price_cents and t.registration_price_cents>0) as paid_teams,
      count(t.id) filter(where t.status in ('pending','accepted') and t.registration_price_cents>coalesce(r.received,0)) as unpaid_teams,
      coalesce(sum(t.registration_price_cents) filter(where t.status in ('pending','accepted')),0)::bigint as expected,
      coalesce(sum(r.received),0)::bigint as received,
      coalesce(sum(r.received) filter(where t.status in ('pending','accepted')),0)::bigint as active_received,
      coalesce(sum(greatest(t.registration_price_cents-coalesce(r.received,0),0)) filter(where t.status in ('pending','accepted')),0)::bigint as outstanding
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
    'expected_cents',coalesce(sum(expected),0),
    'maximum_cents',coalesce(sum(expected+greatest(capacity-registered,0)*fee),0),
    'outstanding_cents',coalesce(sum(outstanding),0),
    'series',coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'name',name,'registered_teams',registered,'capacity',capacity,
      'received_cents',received,'expected_cents',expected,
      'maximum_cents',expected+greatest(capacity-registered,0)*fee,'outstanding_cents',outstanding
    ) order by name,id),'[]'::jsonb),
    'coverage','stripe_and_manual_confirmed'
  ) into result from series_totals;
  return result;
end;
$$;
revoke all on function public.admin_get_tournament_financial_summary_for_club(uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_get_tournament_financial_summary_for_club(uuid,uuid) to authenticated;
