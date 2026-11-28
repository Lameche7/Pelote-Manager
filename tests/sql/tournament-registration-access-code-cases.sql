-- Ephemeral CI only: code access must never cross accounts or tournaments.
begin;
select set_config('request.jwt.claim.role','authenticated',true);
do $check$
declare
  club_b uuid := '00000000-0000-0000-0000-000000000002';
  admin_b uuid := '20000000-0000-0000-0000-000000000002';
  admin_a uuid := '20000000-0000-0000-0000-000000000001';
  player_a uuid := '20000000-0000-0000-0000-000000000003';
  player_b uuid := '20000000-0000-0000-0000-000000000004';
  t uuid;
  t2 uuid;
  result jsonb;
  i integer;
begin
  perform set_config('request.jwt.claim.sub',admin_b::text,true);
  insert into public.club_role_permissions(role_id,permission_key)
  values ('10000000-0000-0000-0000-000000000002','tournaments.manage')
  on conflict do nothing;
  insert into public.tournaments(club_id,season_id,name,status,starts_on,ends_on,registration_opens_at,registration_closes_at)
  values(club_b,'70000000-0000-0000-0000-000000000002','Access code CI','registrations_open',current_date+2,current_date+8,now()-interval '1 hour',now()+interval '1 day')
  returning id into t;
  insert into public.tournaments(club_id,season_id,name,status,starts_on,ends_on,registration_opens_at,registration_closes_at)
  values(club_b,'70000000-0000-0000-0000-000000000002','Independent CI','registrations_open',current_date+2,current_date+8,now()-interval '1 hour',now()+interval '1 day')
  returning id into t2;
  perform public.admin_set_tournament_registration_access(t,'locked','Priority-CI-1',null);
  perform public.admin_set_tournament_registration_access(t2,'locked','Priority-CI-2',null);
  perform set_config('request.jwt.claim.sub',player_a::text,true);
  begin
    perform pilotoki_private.require_tournament_registration_access(t);
    raise exception 'Missing code allowed';
  exception when insufficient_privilege then null; end;
  result:=public.unlock_tournament_registration(t,'Priority-CI-1');
  if result->>'unlocked' is distinct from 'true' then raise exception 'Correct code refused'; end if;
  perform pilotoki_private.require_tournament_registration_access(t);
  if public.get_tournament_registration_access(t)->>'unlocked' is distinct from 'true' then
    raise exception 'Authorization not restored';
  end if;
  begin
    perform pilotoki_private.require_tournament_registration_access(t2);
    raise exception 'Authorization leaked across tournaments';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',player_b::text,true);
  if public.get_tournament_registration_access(t)->>'unlocked' is distinct from 'false' then
    raise exception 'Authorization leaked across accounts';
  end if;
  for i in 1..5 loop
    result:=public.unlock_tournament_registration(t,'Wrong-code');
    if result->>'unlocked' is distinct from 'false' then raise exception 'Wrong code allowed'; end if;
  end loop;
  result:=public.unlock_tournament_registration(t,'Priority-CI-1');
  if result->>'unlocked' is distinct from 'false' or result->>'retry_at' is null then
    raise exception 'Attempt limit not enforced';
  end if;
  update pilotoki_private.tournament_registration_access_attempts
    set window_started_at=now()-interval '16 minutes' where tournament_id=t and actor_id=player_b;
  result:=public.unlock_tournament_registration(t,'Priority-CI-1');
  if result->>'unlocked' is distinct from 'true' then raise exception 'Attempt window not reset'; end if;
  perform set_config('request.jwt.claim.sub',admin_a::text,true);
  begin
    perform public.admin_set_tournament_registration_access(t,'free',null,null);
    raise exception 'Other club administrator modified policy';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',admin_b::text,true);
  perform public.admin_set_tournament_registration_access(t,'locked','Priority-CI-3',null);
  perform set_config('request.jwt.claim.sub',player_a::text,true);
  begin
    perform pilotoki_private.require_tournament_registration_access(t);
    raise exception 'Rotated code authorization still active';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',admin_b::text,true);
  perform public.admin_set_tournament_registration_access(t,'temporary',null,now()+interval '1 hour');
  update pilotoki_private.tournament_registration_access
    set opens_public_at=now()-interval '1 second' where tournament_id=t;
  perform set_config('request.jwt.claim.sub',player_a::text,true);
  perform pilotoki_private.require_tournament_registration_access(t);
  if public.get_tournament_registration_access(t)->>'code_required' is distinct from 'false' then
    raise exception 'Expired priority window still locked';
  end if;
  if has_table_privilege('authenticated','pilotoki_private.tournament_registration_access','SELECT')
    or has_table_privilege('anon','pilotoki_private.tournament_registration_access','SELECT')
    or has_function_privilege('anon','public.unlock_tournament_registration(uuid,text)','EXECUTE') then
    raise exception 'Code storage or verification exposed';
  end if;
  perform set_config('request.jwt.claim.sub',admin_b::text,true);
  perform public.admin_set_tournament_registration_access(t,'free',null,null);
  perform set_config('request.jwt.claim.sub',player_b::text,true);
  perform pilotoki_private.require_tournament_registration_access(t);
end $check$;
rollback;
