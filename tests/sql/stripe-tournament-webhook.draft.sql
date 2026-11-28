-- Draft: atomic recording of verified Stripe checkout events.
-- The Edge Function must verify Stripe's signature before calling this RPC.
create or replace function public.record_tournament_stripe_event(
  event_id text, account_id text, event_livemode boolean,
  attempt_id uuid, session_id text, intent_id text,
  paid_amount integer, paid_currency text, event_status text
) returns text
language plpgsql security invoker set search_path = ''
as $$
declare
  payment public.tournament_stripe_payment_attempts%rowtype;
begin
  if event_id is null or event_id !~ '^evt_[A-Za-z0-9]+$'
    or session_id is null or session_id !~ '^cs_[A-Za-z0-9_]+$'
    or event_status is null or event_status not in ('paid','expired','processing')
    or event_livemode is null then
    raise exception 'Invalid Stripe event' using errcode='22023';
  end if;
  -- Match checkout/hold expiry lock ordering (team first, then attempt).
  perform 1 from public.tournament_teams t
    join public.tournament_stripe_payment_attempts a on a.team_id=t.id
    where a.id=attempt_id for update of t;
  select * into payment from public.tournament_stripe_payment_attempts p
    where p.id=attempt_id for update;
  if not found or payment.stripe_account_id is distinct from account_id
    or payment.livemode is distinct from event_livemode
    or payment.amount_cents is distinct from paid_amount
    or payment.currency is distinct from paid_currency
    or (payment.stripe_session_id is not null and payment.stripe_session_id is distinct from session_id)
    or (payment.stripe_payment_intent_id is not null and payment.stripe_payment_intent_id is distinct from intent_id)
    then raise exception 'Stripe event scope mismatch' using errcode='22023';
  end if;
  if event_status='paid' and (intent_id is null or intent_id !~ '^pi_[A-Za-z0-9]+$') then
    raise exception 'Missing Stripe payment intent' using errcode='22023';
  end if;
  insert into public.stripe_processed_events(stripe_event_id,stripe_account_id,livemode)
    values(event_id,account_id,event_livemode) on conflict do nothing;
  if not found then return 'duplicate'; end if;
  -- Out-of-order delivery must not downgrade a settled or disputed attempt.
  if payment.status in ('paid','refunded','disputed') then return 'unchanged'; end if;
  if event_status='paid' then
    update public.tournament_stripe_payment_attempts
      set status='paid', stripe_session_id=session_id,
          stripe_payment_intent_id=intent_id, paid_at=now()
      where id=attempt_id;
  elsif payment.status in ('creating','open','processing') then
    update public.tournament_stripe_payment_attempts
      set status=event_status, stripe_session_id=session_id,
          stripe_payment_intent_id=coalesce(intent_id,payment.stripe_payment_intent_id)
      where id=attempt_id;
  end if;
  return 'recorded';
end;
$$;
revoke all on function public.record_tournament_stripe_event(text,text,boolean,uuid,text,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.record_tournament_stripe_event(text,text,boolean,uuid,text,text,integer,text,text) to service_role;
