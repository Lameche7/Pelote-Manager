-- Ephemeral CI only: expired holds release only when payment state is safe.
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
  insert into public.club_payment_policies(club_id,tournament_confirmation,stripe_tournament_enabled,tournament_hold_place,tournament_hold_hours)
    values(b,'payment_required',true,true,1);
  insert into public.club_stripe_connections(club_id,stripe_account_id,livemode,charges_enabled,verified_at)
    values(b,'acct_HoldCI',true,true,now());
  update public.tournaments set status='registrations_open',registration_opens_at=now()-interval '1 day' where id=t;
  insert into public.tournament_teams(tournament_id,series_id,status,contact_email,submitted_by,registered_at)
    values(t,s,'pending','hold@example.test',actor,now()-interval '2 hours') returning id into team;
  attempt:=(public.prepare_tournament_stripe_checkout(actor,team,true)->>'attempt_id')::uuid;
  if public.release_expired_tournament_payment_holds(100)<>0 then
    raise exception 'Uncertain checkout released';
  end if;
  perform public.record_tournament_stripe_event('evt_holdexpired','acct_HoldCI',true,attempt,'cs_live_hold',null,1500,'eur','expired');
  -- Execute the mutating function before reading the resulting row in a new statement.
  if public.release_expired_tournament_payment_holds(100)<>1 then
    raise exception 'Expired checkout hold release count incorrect';
  end if;
  if (select status::text from public.tournament_teams where id=team) is distinct from 'withdrawn' then
    raise exception 'Expired checkout hold status not withdrawn';
  end if;
  if public.release_expired_tournament_payment_holds(100)<>0 then
    raise exception 'Release not idempotent';
  end if;
  begin
    perform public.prepare_tournament_stripe_checkout(actor,team,true);
    raise exception 'Released hold allowed checkout' using errcode='XX000';
  exception when insufficient_privilege then null; end;
  insert into public.tournament_teams(tournament_id,series_id,status,contact_email,submitted_by,registered_at)
    values(t,s,'pending','hold2@example.test',actor,now()-interval '2 hours') returning id into team;
  if public.release_expired_tournament_payment_holds(100)<>1 then
    raise exception 'Unstarted expired hold not released';
  end if;
  insert into public.tournament_teams(tournament_id,series_id,status,contact_email,submitted_by,registered_at)
    values(t,s,'pending','hold3@example.test',actor,now()) returning id into team;
  if public.release_expired_tournament_payment_holds(100)<>0 then
    raise exception 'Fresh hold released early';
  end if;
  if has_function_privilege('authenticated','public.release_expired_tournament_payment_holds(integer)','EXECUTE')
    or has_function_privilege('anon','public.release_expired_tournament_payment_holds(integer)','EXECUTE')
    or not has_function_privilege('service_role','public.release_expired_tournament_payment_holds(integer)','EXECUTE') then
    raise exception 'Unexpected hold expiry privileges';
  end if;
end $check$;
rollback;
