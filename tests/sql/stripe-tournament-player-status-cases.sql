-- Ephemeral CI only: verify player payment visibility and ownership.
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
  if public.get_my_tournament_stripe_payment(team) is not null then
    raise exception 'Test-mode payment exposed to player';
  end if;
  update public.club_stripe_connections set livemode=true where club_id=b;
  if public.get_my_tournament_stripe_payment(team)->>'status' is distinct from 'unpaid'
    or public.get_my_tournament_stripe_payment(team)->>'amount_cents' is distinct from '1500'
    or public.get_my_tournament_stripe_payment(team)->>'can_pay' is distinct from 'true' then
    raise exception 'Incorrect live payment summary';
  end if;
  perform set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
  if public.get_my_tournament_stripe_payment(team) is not null then
    raise exception 'Another player can inspect payment';
  end if;
  if has_function_privilege('anon','public.get_my_tournament_stripe_payment(uuid)','EXECUTE')
    or not has_function_privilege('authenticated','public.get_my_tournament_stripe_payment(uuid)','EXECUTE') then
    raise exception 'Unexpected player payment permissions';
  end if;
end $check$;
rollback;
