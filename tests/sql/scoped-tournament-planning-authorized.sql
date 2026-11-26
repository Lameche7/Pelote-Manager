-- Ephemeral CI only: two tournaments and two resources, all rolled back.
begin;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select public.issue_platform_admin_lease('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',300);
reset role;
select set_config('request.jwt.claim.role','authenticated',true);
do $check$
declare
  c uuid := '00000000-0000-0000-0000-000000000002';
  r1 uuid := '71000000-0000-0000-0000-000000000002';
  r2 uuid := '71000000-0000-0000-0000-000000000003';
  t uuid;
  s uuid;
  t1 uuid;
  t2 uuid;
  team uuid;
  j integer;
  i integer;
  teams jsonb;
  p1 jsonb;
  p2 jsonb;
  w jsonb;
  shared_identity uuid;
  first_team uuid;
begin
  insert into public.reservable_resources(id,club_id,name) values(r2,c,'CI second court');
  for j in 1..2 loop
  t := public.platform_admin_create_tournament(c,jsonb_build_object(
    'season_id','70000000-0000-0000-0000-000000000002','name','CI planning '||j,
    'pool_starts_on','2027-02-01','pool_ends_on','2027-02-28',
    'finals_starts_on','2027-03-01','finals_ends_on','2027-03-07',
    'registration_opens_at',now()+interval '1 day','registration_closes_at',now()+interval '2 days',
    'registration_fee_cents',1500));
  perform public.platform_admin_save_tournament_configuration(c,t,jsonb_build_object(
    'resource_ids',jsonb_build_array(r1,r2),
    'series',jsonb_build_array(jsonb_build_object('name','CI series','capacity',8,'enabled',true)),
    'play_windows',jsonb_build_array(jsonb_build_object('weekday',1,'opens_at','18:00','closes_at','20:00'))));
  s := (public.platform_admin_get_tournament(c,t)->'series'->0->>'id')::uuid;

    if j=1 then t1:=t; else t2:=t; end if;
    update public.tournaments set status='registrations_closed' where id=t;
    teams:='[]'::jsonb;
    for i in 1..3 loop
      insert into public.tournament_teams(tournament_id,series_id,status,contact_email)
        values(t,s,'accepted','planning-'||j||'-'||i||'@example.test') returning id into team;
      insert into public.tournament_team_players(team_id,tournament_id,role,first_name,last_name,email,display_order,club_name)
        values(team,t,'front','Fixture','Player '||j||'-'||i,'planning-'||j||'-'||i||'@example.test',0,'Club B');
      insert into public.tournament_team_availability_slots(team_id,tournament_id,play_date,starts_at,ends_at)
        select team,t,play_date,starts_at,ends_at from public.tournament_generated_slots(t) where phase='pools';
      teams:=teams||jsonb_build_array(jsonb_build_object('team_id',team,'display_order',i-1));
    end loop;
    perform public.admin_save_tournament_pools_for_club(c,t,jsonb_build_object('pools',jsonb_build_array(jsonb_build_object('series_id',s,'display_order',0,'target_size',3,'teams',teams))));
    perform public.admin_validate_tournament_pools_for_club(c,t);
    if public.admin_prepare_tournament_matches_for_club(c,t)<>3 then raise exception 'Expected three matches'; end if;
    if public.admin_prepare_tournament_matches_for_club(c,t)<>3 then raise exception 'Duplicate match preparation'; end if;
    select jsonb_build_object('planning',jsonb_agg(jsonb_build_object('match_id',m.id,'resource_id',r1,'play_date',g.play_date,'starts_at',g.starts_at,'ends_at',g.ends_at,'source','generated') order by m.n))
    into w
    from (select id,row_number() over(order by display_order) n from public.tournament_matches where tournament_id=t) m
    join (select play_date,starts_at,ends_at,row_number() over(order by play_date,starts_at) n from public.tournament_generated_slots(t) where phase='pools') g on g.n=m.n;
    if j=1 then p1:=w; else p2:=w; end if;
  end loop;
  perform public.admin_save_tournament_planning_for_club(c,t1,p1);
  begin
    perform public.admin_save_tournament_planning_for_club(c,t2,p2);
    raise exception 'Overlapping court accepted' using errcode='XX000';
  exception when raise_exception then
    if sqlerrm<>'Tournament planning conflicts with another tournament' then raise; end if;
  end;
  select jsonb_build_object('planning',jsonb_agg(value||jsonb_build_object('resource_id',r2))) into p2 from jsonb_array_elements(p2->'planning');
  perform public.admin_save_tournament_planning_for_club(c,t2,p2);
  w:=public.admin_get_tournament_planning_workspace_for_club(c,t2);
  if exists(select 1 from jsonb_array_elements(w->'slots') x join jsonb_array_elements(p1->'planning') y on x->>'resource_id'=y->>'resource_id' and x->>'date'=y->>'play_date' and (x->>'starts_at')::time<(y->>'ends_at')::time and (x->>'ends_at')::time>(y->>'starts_at')::time) then raise exception 'Occupied court still offered'; end if;
  insert into public.tournament_external_player_identities(first_name,last_name,first_name_normalized,last_name_normalized) values('Fixture','Shared','fixture','shared') returning id into shared_identity;
  update public.tournament_team_players set external_identity_id=shared_identity where team_id in (
    (select team_a_id from public.tournament_matches where id=(p1->'planning'->0->>'match_id')::uuid),
    (select team_a_id from public.tournament_matches where id=(p2->'planning'->0->>'match_id')::uuid)
  );
  begin
    perform public.admin_save_tournament_planning_for_club(c,t2,p2);
    raise exception 'Overlapping shared player accepted' using errcode='XX000';
  exception when raise_exception then
    if sqlerrm<>'Tournament planning conflicts with another tournament' then raise; end if;
  end;
  if (select count(*) from public.tournament_match_planning where tournament_id=t2)<>3 then raise exception 'Rejected save changed prior planning'; end if;
end $check$;
rollback;
