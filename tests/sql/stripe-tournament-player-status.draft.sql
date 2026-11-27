-- Draft: owner-only payment summary. Test transactions must never appear as real payments.
create or replace function public.get_my_tournament_stripe_payment(target_team_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  team_row public.tournament_teams%rowtype;
  tournament_row public.tournaments%rowtype;
  payment public.tournament_stripe_payment_attempts%rowtype;
  available boolean;
  manual_received bigint;
  remaining_cents bigint;
  gross_received bigint;
  refunded bigint;
  refund_pending bigint;
  manual_methods text[];
begin
  if auth.uid() is null or target_team_id is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  select * into team_row from public.tournament_teams
    where id=target_team_id and submitted_by=auth.uid();
  if not found then return null; end if;
  select * into tournament_row from public.tournaments where id=team_row.tournament_id;
  if not found then return null; end if;
  select * into payment from public.tournament_stripe_payment_attempts
    where team_id=team_row.id and club_id=tournament_row.club_id
      and tournament_id=tournament_row.id and livemode
    order by case when status in ('paid','disputed','processing','open','creating') then 0 else 1 end,
      created_at desc, id desc limit 1;
  select coalesce(sum(amount_cents),0) into manual_received
    from public.tournament_manual_receipts where team_id=team_row.id
      and club_id=tournament_row.club_id and tournament_id=tournament_row.id;
  remaining_cents := greatest(team_row.registration_price_cents-manual_received
    -case when payment.status='paid' then payment.amount_cents else 0 end,0);
  gross_received := manual_received+case when payment.status='paid' then payment.amount_cents else 0 end;
  select coalesce(sum(amount_cents) filter(where status='succeeded'),0),
    coalesce(sum(amount_cents) filter(where status in ('requested','pending')),0)
    into refunded,refund_pending from public.tournament_payment_refunds
    where team_id=team_row.id and club_id=tournament_row.club_id and tournament_id=tournament_row.id;
  if refunded+refund_pending>0 then remaining_cents:=0; end if;
  available := exists (
    select 1 from public.club_stripe_connections c
      where c.club_id=tournament_row.club_id and c.livemode
        and c.charges_enabled and c.verified_at is not null
  ) and team_row.registration_price_cents>0;
  select array_remove(array[
    case when p.cash_enabled then 'cash' end,
    case when p.cheque_enabled then 'cheque' end,
    case when p.bank_transfer_enabled then 'bank_transfer' end
  ]::text[],null) into manual_methods
  from public.club_payment_policies p where p.club_id=tournament_row.club_id;
  manual_methods:=coalesce(manual_methods,array[]::text[]);
  if not available and payment.id is null and manual_received=0 and cardinality(manual_methods)=0 then return null; end if;
  return jsonb_build_object(
    'status',case when payment.status='disputed' then 'disputed'
      when refund_pending>0 then 'refund_pending'
      when refunded>0 and refunded>=gross_received then 'refunded'
      when refunded>0 then 'partially_refunded'
      when remaining_cents=0 and team_row.registration_price_cents>0 then 'paid' else coalesce(payment.status,'unpaid') end,
    'amount_cents',team_row.registration_price_cents,
    'remaining_cents',remaining_cents,
    'received_cents',gross_received,
    'refunded_cents',refunded,
    'refund_pending_cents',refund_pending,
    'net_received_cents',gross_received-refunded,
    'can_pay',available and refunded+refund_pending=0 and remaining_cents>0 and team_row.status in ('pending','accepted')
      and coalesce(public.tournament_registration_is_open(tournament_row.id),false)
      and coalesce(payment.status,'unpaid') in ('unpaid','creating','open','expired','failed'),
    'manual_methods',to_jsonb(manual_methods),
    'paid_at',payment.paid_at
  );
end;
$$;
revoke all on function public.get_my_tournament_stripe_payment(uuid) from public,anon,authenticated;
grant execute on function public.get_my_tournament_stripe_payment(uuid) to authenticated;
