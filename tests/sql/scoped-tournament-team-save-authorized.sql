-- Ephemeral PostgreSQL only. No production data. Roll back all changes.
begin;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select public.issue_platform_admin_lease('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 300);
reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $check$
declare
  c uuid := '00000000-0000-0000-0000-000000000002';
  s uuid := '70000000-0000-0000-0000-000000000002';
  r uuid := '71000000-0000-0000-0000-000000000002';
  t uuid;
  series_id uuid;
  draft jsonb;
  cfg jsonb;
begin
  draft := jsonb_build_object('season_id',s,'name','CI team save tournament',
    'pool_starts_on','2027-02-01','pool_ends_on','2027-02-28',
    'finals_starts_on','2027-03-01','finals_ends_on','2027-03-07',
    'registration_opens_at',now()+interval '1 day',
    'registration_closes_at',now()+interval '2 days','registration_fee_cents',1500);
  t := public.platform_admin_create_tournament(c,draft);
  cfg := jsonb_build_object('resource_ids',jsonb_build_array(r),
    'series',jsonb_build_array(jsonb_build_object('name','CI series','capacity',8,'enabled',true)),
    'play_windows',jsonb_build_array(jsonb_build_object('weekday',1,'opens_at','18:00','closes_at','20:00')));
  perform public.platform_admin_save_tournament_configuration(c,t,cfg);
  series_id := (public.platform_admin_get_tournament(c,t)->'series'->0->>'id')::uuid;
  if series_id is null then raise exception 'Missing series'; end if;
  perform set_config('ci.team_tournament',t::text,true);
  perform set_config('ci.team_series',series_id::text,true);
end $check$;
reset role;
-- Require two native pool slots and verify valid and invalid dated availability.
update public.tournaments
set minimum_availability_slots = 2, minimum_weekend_availability_slots = 0
where id = current_setting('ci.team_tournament')::uuid;
set local role authenticated;
do $check$
declare
  c uuid := '00000000-0000-0000-0000-000000000002';
  t uuid := current_setting('ci.team_tournament')::uuid;
  s uuid := current_setting('ci.team_series')::uuid;
  p jsonb;
  result jsonb;
  team_id uuid;
begin
  p := jsonb_build_object('series_id',s,'status','accepted','comments','CI initial',
    'players','[{"role":"front","first_name":"Test","last_name":"Avant","club_name":"External A","email":"front@example.test","phone":"0600000001"},{"role":"back","first_name":"Test","last_name":"Arriere","club_name":"External B","email":"back@example.test","phone":"0600000002"}]'::jsonb,
    'availability_slots','[{"date":"2027-02-01","starts_at":"18:00","ends_at":"19:00"},{"date":"2027-02-01","starts_at":"19:00","ends_at":"20:00"}]'::jsonb);
  result := public.admin_save_tournament_team_v5_for_club(c,t,null,p);
  team_id := (result->>'team_id')::uuid;
  if team_id is null or result->>'pools_invalidated' is distinct from 'false' then
    raise exception 'Unexpected save result';
  end if;
  result := public.admin_save_tournament_team_v5_for_club(c,t,team_id,p || '{"comments":"CI updated"}'::jsonb);
  if result->>'team_id' is distinct from team_id::text then
    raise exception 'Update created a different team';
  end if;
  begin
    perform public.admin_save_tournament_team_v5_for_club(c,t,team_id,
      jsonb_set(p,'{players,0,member_id}','"40000000-0000-0000-0000-000000000003"'::jsonb));
    raise exception 'Foreign member accepted' using errcode='XX000';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_save_tournament_team_v5_for_club(c,t,team_id,
      p || '{"availability_slots":[]}'::jsonb);
    raise exception 'Missing pool minimum accepted' using errcode='XX000';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_save_tournament_team_v5_for_club(c,t,team_id,
      jsonb_set(p,'{availability_slots,1}',p->'availability_slots'->0));
    raise exception 'Duplicate slot accepted' using errcode='XX000';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_save_tournament_team_v5_for_club(c,t,team_id,
      jsonb_set(p,'{availability_slots,0,date}','"2027-02-02"'::jsonb));
    raise exception 'Off-window slot accepted' using errcode='XX000';
  exception when invalid_parameter_value then null;
  end;
  perform set_config('ci.saved_team',team_id::text,true);
  perform set_config('ci.team_payload',p::text,true);
end $check$;
reset role;
do $check$
declare
  team_id_value uuid := current_setting('ci.saved_team')::uuid;
  t uuid := current_setting('ci.team_tournament')::uuid;
begin
  if not exists (select 1 from public.tournament_teams where id=team_id_value
    and tournament_id=t and comments='CI updated' and status='accepted'
    and contact_email='front@example.test' and contact_phone='0600000001') then
    raise exception 'Saved team fields incorrect';
  end if;
  if (select count(*) from public.tournament_team_players where team_id=team_id_value) <> 2 then
    raise exception 'Expected exactly two players';
  end if;
  if not exists (select 1 from public.tournament_team_players where team_id=team_id_value
    and role='back' and club_name='External B' and email='back@example.test') then
    raise exception 'Player fields incorrect';
  end if;
  if (select count(*) from public.tournament_team_availability_slots where team_id=team_id_value) <> 2 then
    raise exception 'Expected two preserved dated availability slots';
  end if;
  if (select count(*) from public.tournament_teams where tournament_id=t) <> 1 then
    raise exception 'Unexpected duplicate team';
  end if;
end $check$;
-- Seed the pool state only in this isolated test transaction.
insert into public.tournament_pools(tournament_id,series_id,display_order,target_size)
values (current_setting('ci.team_tournament')::uuid,current_setting('ci.team_series')::uuid,0,4);
insert into public.tournament_pool_teams(pool_id,team_id,display_order)
select id,current_setting('ci.saved_team')::uuid,0
from public.tournament_pools where tournament_id=current_setting('ci.team_tournament')::uuid;
update public.tournaments set status='pools_generated'
where id=current_setting('ci.team_tournament')::uuid;
set local role authenticated;
do $check$
declare
  c uuid := '00000000-0000-0000-0000-000000000002';
  t uuid := current_setting('ci.team_tournament')::uuid;
  team_id_value uuid := current_setting('ci.saved_team')::uuid;
  p jsonb := current_setting('ci.team_payload')::jsonb;
  result jsonb;
begin
  result := public.admin_save_tournament_team_v5_for_club(c,t,team_id_value,
    jsonb_set(p,'{players,0,email}','"updated@example.test"'::jsonb));
  if result->>'team_id' is distinct from team_id_value::text
    or result->>'pools_invalidated' is distinct from 'false' then
    raise exception 'Nonstructural update invalidated pools';
  end if;
end $check$;
reset role;
do $check$
begin
  if not exists (
    select 1 from public.tournament_pools p
    join public.tournament_pool_teams pt on pt.pool_id=p.id
    join public.tournaments t on t.id=p.tournament_id
    where t.id=current_setting('ci.team_tournament')::uuid
      and t.status='pools_generated'
      and pt.team_id=current_setting('ci.saved_team')::uuid
  ) then raise exception 'Pool assignment or status not preserved'; end if;
  if not exists (
    select 1 from public.tournament_teams
    where id=current_setting('ci.saved_team')::uuid and contact_email='updated@example.test'
  ) then raise exception 'Contact update not persisted'; end if;
end $check$;
set local role authenticated;
do $check$
declare
  result jsonb;
begin
  result := public.admin_save_tournament_team_v5_for_club(
    '00000000-0000-0000-0000-000000000002',
    current_setting('ci.team_tournament')::uuid,
    current_setting('ci.saved_team')::uuid,
    current_setting('ci.team_payload')::jsonb || '{"status":"pending"}'::jsonb);
  if result->>'pools_invalidated' is distinct from 'true' then
    raise exception 'Structural update did not invalidate pools';
  end if;
end $check$;
reset role;
do $check$
begin
  if exists (select 1 from public.tournament_pools
    where tournament_id=current_setting('ci.team_tournament')::uuid)
    or exists (select 1 from public.tournament_pool_teams
    where team_id=current_setting('ci.saved_team')::uuid)
    or not exists (select 1 from public.tournaments
    where id=current_setting('ci.team_tournament')::uuid and status='registrations_closed')
    or not exists (select 1 from public.tournament_teams
    where id=current_setting('ci.saved_team')::uuid and status='pending')
  then raise exception 'Structural update left inconsistent pool state'; end if;
end $check$;
rollback;
