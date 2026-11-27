-- Ephemeral CI only: registration status is conditioned on verified live payment.
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
  mixed_team uuid;
  cash_team uuid;
  receipt uuid;
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
  insert into public.club_payment_policies(club_id,tournament_confirmation,stripe_tournament_enabled)
    values(b,'payment_required',true);
  insert into public.tournament_teams(tournament_id,series_id,status,contact_email,submitted_by)
    values(t,s,'pending','guard@example.test',actor) returning id into team;
  if (select status::text from public.tournament_teams where id=team) is distinct from 'pending' then
    raise exception 'Unpaid registration auto-accepted';
  end if;
  begin
    update public.tournament_teams set status='accepted' where id=team;
    raise exception 'Unpaid registration accepted by direct update' using errcode='XX000';
  exception when check_violation then null; end;
  update public.tournaments set status='registrations_open',registration_opens_at=now()-interval '1 day' where id=t;
  insert into public.club_stripe_connections(club_id,stripe_account_id,charges_enabled,verified_at)
    values(b,'acct_GuardCI',true,now());
  attempt:=(public.prepare_tournament_stripe_checkout(actor,team,false)->>'attempt_id')::uuid;
  perform public.record_tournament_stripe_event('evt_guardtest','acct_GuardCI',false,attempt,'cs_test_guard','pi_guardtest',1500,'eur','paid');
  if (select status::text from public.tournament_teams where id=team) is distinct from 'pending' then
    raise exception 'Sandbox payment accepted real registration';
  end if;
  -- Switch the simulated account mode only in this rolled-back fixture.
  update public.club_stripe_connections set livemode=true where club_id=b;
  attempt:=(public.prepare_tournament_stripe_checkout(actor,team,true)->>'attempt_id')::uuid;
  perform public.record_tournament_stripe_event('evt_guardlive','acct_GuardCI',true,attempt,'cs_live_guard','pi_guardlive',1500,'eur','paid');
  if (select status::text from public.tournament_teams where id=team) is distinct from 'accepted' then
    raise exception 'Confirmed payment did not accept registration';
  end if;
  update public.tournament_teams set status='pending',validated_at=null where id=team;
  if (select status::text from public.tournament_teams where id=team) is distinct from 'accepted' then
    raise exception 'Paid registration lost acceptance on edit';
  end if;
  update public.tournament_teams set status='withdrawn' where id=team;
  perform public.record_tournament_stripe_event('evt_guardrepeat','acct_GuardCI',true,attempt,'cs_live_guard','pi_guardlive',1500,'eur','paid');
  if (select status::text from public.tournament_teams where id=team) is distinct from 'withdrawn' then
    raise exception 'Withdrawn registration resurrected';
  end if;

  -- A club may explicitly allow cash, and a partial receipt cannot validate a team.
  update public.club_payment_policies set cash_enabled=true where club_id=b;
  insert into public.tournament_teams(tournament_id,series_id,status,contact_email,submitted_by)
    values(t,s,'pending','mixed@example.test',actor) returning id into mixed_team;
  receipt:=public.admin_record_tournament_manual_receipt_for_club(b,t,mixed_team,'cash',500,gen_random_uuid());
  if (select status::text from public.tournament_teams where id=mixed_team) is distinct from 'pending' then
    raise exception 'Partial receipt accepted registration';
  end if;
  attempt:=(public.prepare_tournament_stripe_checkout(actor,mixed_team,true)->>'attempt_id')::uuid;
  if (select amount_cents from public.tournament_stripe_payment_attempts where id=attempt) is distinct from 1000 then
    raise exception 'Card amount did not subtract manual receipt';
  end if;
  perform public.record_tournament_stripe_event('evt_guardmixed','acct_GuardCI',true,attempt,'cs_live_mixed','pi_guardmixed',1000,'eur','paid');
  if (select status::text from public.tournament_teams where id=mixed_team) is distinct from 'accepted' then
    raise exception 'Combined receipts did not confirm registration';
  end if;
  -- Retire the preceding fixture registration before exercising a new one.
  update public.tournament_teams set status='withdrawn' where id=mixed_team;
  insert into public.tournament_teams(tournament_id,series_id,status,contact_email,submitted_by)
    values(t,s,'pending','cash@example.test',actor) returning id into cash_team;
  perform public.admin_record_tournament_manual_receipt_for_club(b,t,cash_team,'cash',1500,gen_random_uuid());
  if (select status::text from public.tournament_teams where id=cash_team) is distinct from 'accepted' then
    raise exception 'Full manual receipt did not confirm registration';
  end if;
  begin
    perform public.prepare_tournament_stripe_checkout(actor,cash_team,true);
    raise exception 'Already paid team offered another checkout' using errcode='XX000';
  exception when invalid_parameter_value then null; end;
end $check$;
rollback;
