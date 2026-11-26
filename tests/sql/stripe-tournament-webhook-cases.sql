-- Ephemeral CI only: verify atomic Stripe webhook processing.
begin;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select public.issue_platform_admin_lease('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',300);
reset role;
select set_config('request.jwt.claim.role','authenticated',true);
do $check$
declare
  b uuid := '00000000-0000-0000-0000-000000000002';
  t uuid;
  s uuid;
  team uuid;
  actor uuid := '20000000-0000-0000-0000-000000000001';
  first_attempt jsonb;
  second_attempt jsonb;
  attempt uuid;
  original_paid_at timestamptz;
begin
  t := public.platform_admin_create_tournament(b,jsonb_build_object(
    'season_id','70000000-0000-0000-0000-000000000002','name','CI Stripe',
    'pool_starts_on','2027-02-01','pool_ends_on','2027-02-28',
    'finals_starts_on','2027-03-01','finals_ends_on','2027-03-07',
    'registration_opens_at',now()+interval '1 day','registration_closes_at',now()+interval '2 days',
    'registration_fee_cents',1500));
  perform public.platform_admin_save_tournament_configuration(b,t,jsonb_build_object(
    'resource_ids',jsonb_build_array('71000000-0000-0000-0000-000000000002'),
    'series',jsonb_build_array(jsonb_build_object('name','CI series','capacity',8,'enabled',true)),
    'play_windows',jsonb_build_array(jsonb_build_object('weekday',1,'opens_at','18:00','closes_at','20:00'))));
  s := (public.platform_admin_get_tournament(b,t)->'series'->0->>'id')::uuid;
  insert into public.tournament_teams(tournament_id,series_id,status,contact_email,submitted_by)
    values(t,s,'pending','checkout@example.test',actor) returning id into team;
  begin
    perform public.prepare_tournament_stripe_checkout(actor,team,false);
    raise exception 'Closed registration accepted' using errcode='XX000';
  exception when invalid_parameter_value then null; end;
  update public.tournaments set status='registrations_open',registration_opens_at=now()-interval '1 day' where id=t;
  begin
    perform public.prepare_tournament_stripe_checkout(actor,team,false);
    raise exception 'Missing Stripe account accepted' using errcode='XX000';
  exception when invalid_parameter_value then null; end;
  insert into public.club_stripe_connections(club_id,stripe_account_id,charges_enabled,verified_at)
    values(b,'acct_CheckoutCI',true,now());
  begin
    perform public.prepare_tournament_stripe_checkout('20000000-0000-0000-0000-000000000004',team,false);
    raise exception 'Foreign actor accepted' using errcode='XX000';
  exception when insufficient_privilege then null; end;
  begin
    perform public.prepare_tournament_stripe_checkout(actor,team,true);
    raise exception 'Wrong payment mode accepted' using errcode='XX000';
  exception when invalid_parameter_value then null; end;
  first_attempt:=public.prepare_tournament_stripe_checkout(actor,team,false);
  second_attempt:=public.prepare_tournament_stripe_checkout(actor,team,false);
  if first_attempt->>'attempt_id' is distinct from second_attempt->>'attempt_id'
    or first_attempt->>'amount_cents' is distinct from '1500'
    or first_attempt->>'stripe_account_id' is distinct from 'acct_CheckoutCI' then
    raise exception 'Checkout scope, amount or idempotency mismatch';
  end if;
  if has_function_privilege('authenticated','public.prepare_tournament_stripe_checkout(uuid,uuid,boolean)','EXECUTE')
    or has_function_privilege('anon','public.prepare_tournament_stripe_checkout(uuid,uuid,boolean)','EXECUTE')
    or not has_function_privilege('service_role','public.prepare_tournament_stripe_checkout(uuid,uuid,boolean)','EXECUTE') then
    raise exception 'Unexpected checkout permissions';
  end if;
  attempt := (first_attempt->>'attempt_id')::uuid;
  begin
    perform public.record_tournament_stripe_event('evt_badamount','acct_CheckoutCI',false,attempt,'cs_test_CI','pi_CI',1,'eur','paid');
    raise exception 'Wrong amount accepted' using errcode='XX000';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.record_tournament_stripe_event('evt_badaccount','acct_OtherCI',false,attempt,'cs_test_CI','pi_CI',1500,'eur','paid');
    raise exception 'Wrong account accepted' using errcode='XX000';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.record_tournament_stripe_event('evt_badmode','acct_CheckoutCI',true,attempt,'cs_test_CI','pi_CI',1500,'eur','paid');
    raise exception 'Wrong mode accepted' using errcode='XX000';
  exception when invalid_parameter_value then null; end;
  if public.record_tournament_stripe_event('evt_first','acct_CheckoutCI',false,attempt,'cs_test_CI','pi_CI',1500,'eur','paid') <> 'recorded' then
    raise exception 'Valid payment not recorded';
  end if;
  select paid_at into original_paid_at from public.tournament_stripe_payment_attempts where id=attempt and status='paid';
  if original_paid_at is null then raise exception 'Payment timestamp missing'; end if;
  if public.record_tournament_stripe_event('evt_first','acct_CheckoutCI',false,attempt,'cs_test_CI','pi_CI',1500,'eur','paid') <> 'duplicate' then
    raise exception 'Duplicate event not detected';
  end if;
  if public.record_tournament_stripe_event('evt_late','acct_CheckoutCI',false,attempt,'cs_test_CI','pi_CI',1500,'eur','processing') <> 'unchanged' then
    raise exception 'Late event changed paid attempt';
  end if;
  if not exists(select 1 from public.tournament_stripe_payment_attempts where id=attempt and status='paid' and paid_at=original_paid_at) then
    raise exception 'Payment state not preserved';
  end if;
  if exists(select 1 from public.stripe_processed_events where stripe_event_id in ('evt_badamount','evt_badaccount','evt_badmode')) then
    raise exception 'Rejected event recorded';
  end if;
  if has_function_privilege('authenticated','public.record_tournament_stripe_event(text,text,boolean,uuid,text,text,integer,text,text)','EXECUTE')
    or has_function_privilege('anon','public.record_tournament_stripe_event(text,text,boolean,uuid,text,text,integer,text,text)','EXECUTE')
    or not has_function_privilege('service_role','public.record_tournament_stripe_event(text,text,boolean,uuid,text,text,integer,text,text)','EXECUTE') then
    raise exception 'Unexpected webhook permissions';
  end if;
end $check$;
rollback;
