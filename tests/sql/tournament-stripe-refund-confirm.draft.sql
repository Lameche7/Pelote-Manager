-- Server-only provider state, shared by API response and signed webhooks.
create or replace function public.record_tournament_stripe_refund(
  target_refund_id uuid,provider_account text,provider_intent text,
  provider_refund_id text,provider_amount integer,provider_currency text,
  provider_livemode boolean,provider_status text
) returns text language plpgsql security invoker set search_path=''
as $$
declare
  refund public.tournament_payment_refunds%rowtype;
  payment public.tournament_stripe_payment_attempts%rowtype;
  next_status text;
begin
  if provider_livemode is distinct from true or provider_currency is distinct from 'eur'
    or provider_refund_id is null or provider_refund_id !~ '^re_[A-Za-z0-9]+$'
    or provider_status is null or provider_status not in ('pending','requires_action','succeeded','failed','canceled')
    then raise exception 'Invalid provider refund' using errcode='22023'; end if;
  select * into refund from public.tournament_payment_refunds where id=target_refund_id for update;
  if not found or refund.stripe_attempt_id is null then raise exception 'Refund not found' using errcode='42501'; end if;
  select * into payment from public.tournament_stripe_payment_attempts where id=refund.stripe_attempt_id;
  if not found or payment.livemode is distinct from true
    or payment.stripe_account_id is distinct from provider_account
    or payment.stripe_payment_intent_id is distinct from provider_intent
    or refund.amount_cents is distinct from provider_amount
    or (refund.stripe_refund_id is not null and refund.stripe_refund_id is distinct from provider_refund_id)
    then raise exception 'Refund scope mismatch' using errcode='22023'; end if;
  next_status:=case provider_status when 'canceled' then 'cancelled'
    when 'requires_action' then 'pending' else provider_status end;
  if refund.status in ('succeeded','failed','cancelled') then
    if next_status='pending' or next_status=refund.status then return refund.status; end if;
    raise exception 'Refund terminal state requires reconciliation' using errcode='22023';
  end if;
  update public.tournament_payment_refunds set stripe_refund_id=provider_refund_id,
    status=next_status,confirmed_at=case when next_status='succeeded' then now() else null end
    where id=refund.id;
  return next_status;
end;
$$;
grant select on public.tournament_payment_refunds to service_role;
grant update(stripe_refund_id,status,confirmed_at) on public.tournament_payment_refunds to service_role;
revoke all on function public.record_tournament_stripe_refund(uuid,text,text,text,integer,text,boolean,text) from public,anon,authenticated;
grant execute on function public.record_tournament_stripe_refund(uuid,text,text,text,integer,text,boolean,text) to service_role;
