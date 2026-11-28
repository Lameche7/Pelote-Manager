-- Ephemeral database only. No Stripe network request.
begin;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select public.issue_platform_admin_lease('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',300);
reset role;
select set_config('request.jwt.claim.role','authenticated',true);
do $check$
declare
  b uuid:='00000000-0000-0000-0000-000000000002';
  actor uuid:='20000000-0000-0000-0000-000000000001';
  other_actor uuid:='20000000-0000-0000-0000-000000000004';
  a uuid;
  team_count bigint;
  payment_count bigint;
begin
  select count(*) into team_count from public.tournament_teams;
  select count(*) into payment_count from public.tournament_stripe_payment_attempts;
  insert into public.club_stripe_connections(club_id,stripe_account_id,charges_enabled,verified_at)
    values(b,'acct_DiagnosticCI',true,now());
  begin
    perform public.prepare_tournament_stripe_diagnostic(b,other_actor);
    raise exception 'Unleased actor accepted' using errcode='XX000';
  exception when insufficient_privilege then null; end;
  a:=(public.prepare_tournament_stripe_diagnostic(b,actor)->>'id')::uuid;
  if a is distinct from (public.prepare_tournament_stripe_diagnostic(b,actor)->>'id')::uuid then
    raise exception 'Duplicate active diagnostic';
  end if;
  begin
    perform public.record_tournament_stripe_diagnostic('evt_diaglive','acct_DiagnosticCI',true,a,'cs_test_diag','pi_diag',100,'eur','paid');
    raise exception 'Live event accepted' using errcode='XX000';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.record_tournament_stripe_diagnostic('evt_diagamount','acct_DiagnosticCI',false,a,'cs_test_diag','pi_diag',200,'eur','paid');
    raise exception 'Incorrect amount accepted' using errcode='XX000';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.record_tournament_stripe_diagnostic('evt_diagaccount','acct_OtherCI',false,a,'cs_test_diag','pi_diag',100,'eur','paid');
    raise exception 'Incorrect account accepted' using errcode='XX000';
  exception when invalid_parameter_value then null; end;
  if public.record_tournament_stripe_diagnostic('evt_diagpaid','acct_DiagnosticCI',false,a,'cs_test_diag','pi_diag',100,'eur','paid')<>'recorded' then
    raise exception 'Valid diagnostic not recorded';
  end if;
  if public.record_tournament_stripe_diagnostic('evt_diagpaid','acct_DiagnosticCI',false,a,'cs_test_diag','pi_diag',100,'eur','paid')<>'duplicate' then
    raise exception 'Duplicate diagnostic not detected';
  end if;
  if public.get_my_tournament_stripe_diagnostic(b)->>'status' is distinct from 'paid' then
    raise exception 'Diagnostic result not visible';
  end if;
  if (select count(*) from public.tournament_teams)<>team_count
    or (select count(*) from public.tournament_stripe_payment_attempts)<>payment_count then
    raise exception 'Diagnostic affected real registrations';
  end if;
  if has_table_privilege('authenticated','public.tournament_stripe_diagnostic_attempts','SELECT')
    or has_function_privilege('authenticated','public.prepare_tournament_stripe_diagnostic(uuid,uuid)','EXECUTE')
    or has_function_privilege('anon','public.get_my_tournament_stripe_diagnostic(uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.record_tournament_stripe_diagnostic(text,text,boolean,uuid,text,text,integer,text,text)','EXECUTE') then
    raise exception 'Diagnostic access too broad';
  end if;
end $check$;
rollback;
