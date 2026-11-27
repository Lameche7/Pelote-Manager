-- Ephemeral CI only: verify independent tournament pricing, manual receipts and financial totals.
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
  t2 uuid;
  s2 uuid;
  team2 uuid;
  receipt uuid;
  summary jsonb;
  op uuid := gen_random_uuid();
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
  update public.tournaments set status='registrations_open',registration_opens_at=now()-interval '1 day',registration_fee_cents=2500 where id=t;
  if (select registration_price_cents from public.tournament_teams where id=team)<>1500 then
    raise exception 'Existing registration repriced';
  end if;
  insert into public.club_payment_policies(club_id,cash_enabled,cheque_enabled,bank_transfer_enabled)
    values(b,false,true,false) on conflict(club_id) do update set cash_enabled=false,cheque_enabled=true,bank_transfer_enabled=false;
  begin
    perform public.admin_record_tournament_manual_receipt_for_club(b,t,team,'cash',500,gen_random_uuid());
    raise exception 'Disabled cash accepted' using errcode='XX000';
  exception when invalid_parameter_value then null; end;
  receipt:=public.admin_record_tournament_manual_receipt_for_club(b,t,team,'cheque',500,op);
  if receipt is distinct from public.admin_record_tournament_manual_receipt_for_club(b,t,team,'cheque',500,op) then
    raise exception 'Manual receipt retry duplicated';
  end if;
  insert into public.club_stripe_connections(club_id,stripe_account_id,livemode,charges_enabled,verified_at)
    values(b,'acct_FinanceCI',true,true,now());
  perform public.admin_set_tournament_stripe_policy_for_club(b,true);
  first_attempt:=public.prepare_tournament_stripe_checkout(actor,team,true);
  if first_attempt->>'amount_cents' is distinct from '1000' then raise exception 'Incorrect checkout balance'; end if;
  begin
    perform public.admin_record_tournament_manual_receipt_for_club(b,t,team,'cheque',1000,gen_random_uuid());
    raise exception 'Manual payment accepted during checkout' using errcode='XX000';
  exception when invalid_parameter_value then null; end;
  perform public.record_tournament_stripe_event('evt_financeCI','acct_FinanceCI',true,(first_attempt->>'attempt_id')::uuid,'cs_live_financeCI','pi_financeCI',1000,'eur','paid');
  if public.get_my_tournament_stripe_payment(team)->>'remaining_cents' is distinct from '0'
    or public.get_my_tournament_stripe_payment(team)->>'can_pay' is distinct from 'false' then
    raise exception 'Paid registration still payable';
  end if;
  begin
    perform public.admin_record_tournament_manual_receipt_for_club(b,t,team,'cheque',1,gen_random_uuid());
    raise exception 'Overpayment accepted' using errcode='XX000';
  exception when invalid_parameter_value then null; end;
  summary:=public.admin_get_tournament_financial_summary_for_club(b,t);
  if summary->>'received_cents' is distinct from '1500'
    or summary->>'expected_cents' is distinct from '1500'
    or summary->>'outstanding_cents' is distinct from '0'
    or summary->>'maximum_cents' is distinct from '19000' then
    raise exception 'Incorrect financial totals: %',summary;
  end if;
  t2:=public.platform_admin_create_tournament(b,jsonb_build_object(
    'season_id','70000000-0000-0000-0000-000000000002','name','CI second tournament',
    'pool_starts_on','2027-04-01','pool_ends_on','2027-04-28',
    'finals_starts_on','2027-05-01','finals_ends_on','2027-05-07',
    'registration_opens_at',now()+interval '1 day','registration_closes_at',now()+interval '2 days',
    'registration_fee_cents',2500));
  perform public.platform_admin_save_tournament_configuration(b,t2,jsonb_build_object(
    'resource_ids',jsonb_build_array('71000000-0000-0000-0000-000000000002'),
    'series',jsonb_build_array(jsonb_build_object('name','CI second series','capacity',8,'enabled',true)),
    'play_windows',jsonb_build_array(jsonb_build_object('weekday',1,'opens_at','18:00','closes_at','20:00'))));
  s2:=(public.platform_admin_get_tournament(b,t2)->'series'->0->>'id')::uuid;
  insert into public.tournament_teams(tournament_id,series_id,status,contact_email,submitted_by)
    values(t2,s2,'pending','checkout@example.test',actor) returning id into team2;
  update public.tournaments set status='registrations_open',registration_opens_at=now()-interval '1 day' where id=t2;
  second_attempt:=public.prepare_tournament_stripe_checkout(actor,team2,true);
  if second_attempt->>'amount_cents' is distinct from '2500'
    or second_attempt->>'attempt_id'=first_attempt->>'attempt_id' then
    raise exception 'Second tournament payment not independent';
  end if;
  summary:=public.admin_get_tournament_financial_summary_for_club(b,t2);
  if summary->>'received_cents' is distinct from '0' or summary->>'outstanding_cents' is distinct from '2500' then
    raise exception 'Cross-tournament receipt leakage';
  end if;
  perform set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
  begin
    perform public.admin_get_tournament_financial_summary_for_club(b,t);
    raise exception 'Unauthorized financial read' using errcode='XX000';
  exception when insufficient_privilege then null; end;
end $check$;
rollback;
