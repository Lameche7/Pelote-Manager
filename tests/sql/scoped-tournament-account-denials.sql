-- Ephemeral CI only. No real accounts or production records.
begin;
do $check$
declare
  f record;
  n integer := 0;
begin
  for f in select p.oid,p.proname from pg_proc p join pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and p.proname in ('admin_list_tournament_account_audit_for_club',
      'admin_search_tournament_account_candidates_for_club','admin_link_tournament_account_for_club')
  loop
    n := n+1;
    if has_function_privilege('anon',f.oid,'EXECUTE')
       or not has_function_privilege('authenticated',f.oid,'EXECUTE') then
      raise exception 'Unexpected account RPC privilege: %',f.proname;
    end if;
  end loop;
  if n<>3 then raise exception 'Expected three private account RPCs'; end if;
end $check$;
-- Exercise internal guards as the fixture owner, with fictitious actor claims.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
do $check$
declare
  c uuid := '00000000-0000-0000-0000-000000000002';
  x uuid := '90000000-0000-0000-0000-000000000001';
begin
  begin
    perform public.admin_list_tournament_account_audit_for_club(c,x);
    raise exception 'Unauthorized audit accepted' using errcode='XX000';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_search_tournament_account_candidates_for_club(c,x,x,'');
    raise exception 'Unauthorized search accepted' using errcode='XX000';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_link_tournament_account_for_club(c,x,x,x);
    raise exception 'Unauthorized link accepted' using errcode='XX000';
  exception when insufficient_privilege then null;
  end;
end $check$;
rollback;
