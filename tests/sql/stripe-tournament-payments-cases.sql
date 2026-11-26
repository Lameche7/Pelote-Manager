-- Ephemeral CI only: verify Stripe scope, immutable amounts and privileges.
begin;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select public.issue_platform_admin_lease('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',300);
reset role;
select set_config('request.jwt.claim.role','authenticated',true);
do $check$
declare
  a uuid := '00000000-0000-0000-0000-000000000001';
  b uuid := '00000000-0000-0000-0000-000000000002';
  t uuid;
  s uuid;
  team uuid;
  attempt uuid;
  tab text;
  actor text;
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
  insert into public.tournament_teams(tournament_id,series_id,status,contact_email)
    values(t,s,'pending','stripe@example.test') returning id into team;
  insert into public.club_stripe_connections(club_id,stripe_account_id) values(a,'acct_CIA'),(b,'acct_CIB');
  insert into public.tournament_stripe_payment_attempts(club_id,tournament_id,team_id,stripe_account_id,amount_cents)
    values(b,t,team,'acct_CIB',1500) returning id into attempt;
  begin
    insert into public.tournament_stripe_payment_attempts(club_id,tournament_id,team_id,stripe_account_id,amount_cents)
      values(a,t,team,'acct_CIA',1500);
    raise exception 'Wrong club accepted' using errcode='XX000';
  exception when check_violation then null; end;
  begin
    insert into public.tournament_stripe_payment_attempts(club_id,tournament_id,team_id,stripe_account_id,amount_cents)
      values(b,t,team,'acct_CIA',1500);
    raise exception 'Wrong account accepted' using errcode='XX000';
  exception when check_violation then null; end;
  begin
    insert into public.tournament_stripe_payment_attempts(club_id,tournament_id,team_id,stripe_account_id,livemode,amount_cents)
      values(b,t,team,'acct_CIB',true,1500);
    raise exception 'Wrong mode accepted' using errcode='XX000';
  exception when check_violation then null; end;
  begin
    insert into public.tournament_stripe_payment_attempts(club_id,tournament_id,team_id,stripe_account_id,amount_cents)
      values(b,t,team,'acct_CIB',1500);
    raise exception 'Duplicate attempt accepted' using errcode='XX000';
  exception when unique_violation then null; end;
  begin
    update public.tournament_stripe_payment_attempts set amount_cents=1 where id=attempt;
    raise exception 'Amount tampering accepted' using errcode='XX000';
  exception when check_violation then null; end;
  begin
    update public.tournament_stripe_payment_attempts set status='paid' where id=attempt;
    raise exception 'Unsubstantiated paid status accepted' using errcode='XX000';
  exception when check_violation then null; end;
  update public.tournament_stripe_payment_attempts set status='expired' where id=attempt;
  insert into public.tournament_stripe_payment_attempts(club_id,tournament_id,team_id,stripe_account_id,amount_cents)
    values(b,t,team,'acct_CIB',1500) returning id into attempt;
  insert into public.stripe_processed_events(stripe_event_id,stripe_account_id,livemode)
    values('evt_CI','acct_CIB',false);
  begin
    insert into public.stripe_processed_events(stripe_event_id,stripe_account_id,livemode)
      values('evt_CI','acct_CIB',false);
    raise exception 'Duplicate event accepted' using errcode='XX000';
  exception when unique_violation then null; end;
  foreach tab in array array['club_stripe_connections','tournament_stripe_payment_attempts','stripe_processed_events'] loop
    foreach actor in array array['anon','authenticated'] loop
      if has_table_privilege(actor,'public.'||tab,'SELECT,INSERT,UPDATE,DELETE') then
        raise exception 'Unexpected table privilege % %',actor,tab;
      end if;
    end loop;
    if not exists(select 1 from pg_class where oid=('public.'||tab)::regclass and relrowsecurity) then
      raise exception 'RLS missing for %',tab;
    end if;
  end loop;
end $check$;
rollback;
