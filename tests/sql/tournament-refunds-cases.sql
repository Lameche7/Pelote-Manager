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
  refund_op uuid := gen_random_uuid();
  stripe_op uuid := gen_random_uuid();
  refund uuid;
  stripe_refund uuid;
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
  refund:=public.admin_record_tournament_manual_refund_for_club(b,t,team,receipt,200,'CI partial refund',refund_op);
  if refund is distinct from public.admin_record_tournament_manual_refund_for_club(b,t,team,receipt,200,'CI partial refund',refund_op) then
    raise exception 'Duplicate manual refund';
  end if;
  begin
    perform public.admin_record_tournament_manual_refund_for_club(b,t,team,receipt,301,'CI excessive',gen_random_uuid());
    raise exception 'Excessive manual refund accepted' using errcode='XX000';
  exception when invalid_parameter_value then null; end;
  stripe_refund:=public.admin_prepare_tournament_stripe_refund_for_club(b,t,team,(first_attempt->>'attempt_id')::uuid,600,'CI Stripe refund',stripe_op);
  if stripe_refund is distinct from public.admin_prepare_tournament_stripe_refund_for_club(b,t,team,(first_attempt->>'attempt_id')::uuid,600,'CI Stripe refund',stripe_op) then
    raise exception 'Duplicate Stripe refund';
  end if;
  begin
    perform public.admin_prepare_tournament_stripe_refund_for_club(b,t,team,(first_attempt->>'attempt_id')::uuid,401,'CI excessive',gen_random_uuid());
    raise exception 'Excessive Stripe refund accepted' using errcode='XX000';
  exception when invalid_parameter_value then null; end;
  if (select status from public.tournament_payment_refunds where id=stripe_refund)<>'requested'
    or (select status from public.tournament_teams where id=team)<>'pending'
    or (select amount_cents from public.tournament_manual_receipts where id=receipt)<>500 then
    raise exception 'Refund changed original registration or receipt';
  end if;
  if (select count(*) from public.tournament_refund_notification_events where refund_id in (refund,stripe_refund))<>1
    or not exists(select 1 from public.tournament_refund_notification_events where refund_id=refund)
    then raise exception 'Pending refund notified or manual refund not notified'; end if;
  summary:=public.admin_get_tournament_financial_summary_for_club(b,t);
  if summary->>'received_cents' is distinct from '1500'
    or summary->>'refunded_cents' is distinct from '200'
    or summary->>'refund_pending_cents' is distinct from '600'
    or summary->>'net_received_cents' is distinct from '1300' then
    raise exception 'Pending refund incorrectly affects net receipts: %',summary;
  end if;
  summary:=public.admin_list_tournament_refund_sources_for_club(b,t,team);
  if jsonb_array_length(summary)<>2 or not exists(
    select 1 from jsonb_array_elements(summary) item
    where item->>'method'='stripe' and item->>'refundable_cents'='400'
      and item->'pending_requests'->0->>'operation_id'=stripe_op::text
  ) then raise exception 'Incorrect refundable sources: %',summary; end if;
  begin
    perform public.record_tournament_stripe_refund(stripe_refund,'acct_WrongCI','pi_financeCI','re_financeCI',600,'eur',true,'succeeded');
    raise exception 'Wrong provider account accepted' using errcode='XX000';
  exception when invalid_parameter_value then null; end;
  perform public.record_tournament_stripe_refund(stripe_refund,'acct_FinanceCI','pi_financeCI','re_financeCI',600,'eur',true,'pending');
  perform public.record_tournament_stripe_refund(stripe_refund,'acct_FinanceCI','pi_financeCI','re_financeCI',600,'eur',true,'succeeded');
  perform public.record_tournament_stripe_refund(stripe_refund,'acct_FinanceCI','pi_financeCI','re_financeCI',600,'eur',true,'pending');
  summary:=public.admin_get_tournament_financial_summary_for_club(b,t);
  if summary->>'refunded_cents' is distinct from '800'
    or summary->>'net_received_cents' is distinct from '700'
    or summary->>'refund_pending_cents' is distinct from '0'
    or summary->>'outstanding_cents' is distinct from '0' then
    raise exception 'Incorrect confirmed refund totals: %',summary;
  end if;
  if public.get_my_tournament_stripe_payment(team)->>'can_pay' is distinct from 'false'
    or public.get_my_tournament_stripe_payment(team)->>'status' is distinct from 'partially_refunded' then
    raise exception 'Refunded player offered repayment';
  end if;
  begin
    perform public.prepare_tournament_stripe_checkout(actor,team,true);
    raise exception 'Refunded checkout accepted' using errcode='XX000';
  exception when invalid_parameter_value then null; end;
  if (select count(*) from public.tournament_refund_notification_events where refund_id in (refund,stripe_refund))<>2
    or (select count(*) from public.communication_deliveries d
      join public.tournament_refund_notification_events e on e.communication_id=d.communication_id
      join public.club_communications m on m.id=d.communication_id
      where e.refund_id in (refund,stripe_refund) and d.club_id=b
        and d.profile_id_at_publication=actor and m.status='published' and not m.show_on_home)<>2
    or (select count(*) from public.communication_deliveries d
      join public.tournament_refund_notification_events e on e.communication_id=d.communication_id
      where e.refund_id in (refund,stripe_refund))<>2
    then raise exception 'Refund notification duplicated, missing or misdirected'; end if;
  if has_function_privilege('authenticated','public.record_tournament_stripe_refund(uuid,text,text,text,integer,text,boolean,text)','EXECUTE') then
    raise exception 'Provider confirmation exposed to user';
  end if;
  perform set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
  begin
    perform public.admin_record_tournament_manual_refund_for_club(b,t,team,receipt,100,'CI unauthorized',gen_random_uuid());
    raise exception 'Unauthorized refund accepted' using errcode='XX000';
  exception when insufficient_privilege then null; end;
  if has_table_privilege('authenticated','public.tournament_payment_refunds','SELECT')
    or has_table_privilege('anon','public.tournament_payment_refunds','INSERT') then
    raise exception 'Refund ledger exposed';
  end if;
end $check$;
rollback;
