-- OAuth tests use fictitious accounts only.
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
  actor uuid := '20000000-0000-0000-0000-000000000001';
  state text := repeat('a',64);
  next_state text := repeat('b',64);
begin
  perform public.begin_tournament_stripe_oauth(b,state,true);
  perform set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
  begin
    perform public.consume_tournament_stripe_oauth(state,true);
    raise exception 'Foreign actor consumed state' using errcode='XX000';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  begin
    perform public.consume_tournament_stripe_oauth(state,false);
    raise exception 'Wrong mode consumed state' using errcode='XX000';
  exception when insufficient_privilege then null; end;
  if public.consume_tournament_stripe_oauth(state,true) is distinct from b then
    raise exception 'Incorrect club returned';
  end if;
  begin
    perform public.consume_tournament_stripe_oauth(state,true);
    raise exception 'State replay accepted' using errcode='XX000';
  exception when insufficient_privilege then null; end;
  begin
    perform public.complete_tournament_stripe_oauth(state,actor,a,true,'acct_OAuthCI',true);
    raise exception 'Wrong club accepted' using errcode='XX000';
  exception when insufficient_privilege then null; end;
  perform public.complete_tournament_stripe_oauth(state,actor,b,true,'acct_OAuthCI',true);
  if not exists(select 1 from public.club_stripe_connections
    where club_id=b and stripe_account_id='acct_OAuthCI' and charges_enabled) then
    raise exception 'Connection not saved';
  end if;
  if public.admin_get_tournament_stripe_policy_for_club(b)->>'enabled' is distinct from 'false' then
    raise exception 'Connection enabled payments automatically';
  end if;
  begin
    perform public.complete_tournament_stripe_oauth(state,actor,b,true,'acct_OAuthCI',true);
    raise exception 'Completed state replay accepted' using errcode='XX000';
  exception when insufficient_privilege then null; end;
  perform public.begin_tournament_stripe_oauth(b,next_state,true);
  perform public.consume_tournament_stripe_oauth(next_state,true);
  begin
    perform public.complete_tournament_stripe_oauth(next_state,actor,b,true,'acct_ReplacementCI',true);
    raise exception 'Existing account replaced' using errcode='XX000';
  exception when invalid_parameter_value then null; end;
  if has_function_privilege('authenticated','public.complete_tournament_stripe_oauth(text,uuid,uuid,boolean,text,boolean)','EXECUTE')
    or has_table_privilege('authenticated','public.tournament_stripe_oauth_states','SELECT') then
    raise exception 'Private OAuth state or completion exposed';
  end if;
end $check$;
rollback;
