-- Ephemeral CI only: all data is fictitious and rolled back.
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
  t uuid;
  s uuid;
  team uuid;
  identity_id uuid;
  profile_id_value uuid := '20000000-0000-0000-0000-000000000004';
  other_profile uuid := '20000000-0000-0000-0000-000000000003';
  result jsonb;
  foreign_tournament uuid;
  foreign_series uuid;
  foreign_team uuid;
begin
  t := public.platform_admin_create_tournament(c,jsonb_build_object(
    'season_id','70000000-0000-0000-0000-000000000002','name','CI accounts',
    'pool_starts_on','2027-02-01','pool_ends_on','2027-02-28',
    'finals_starts_on','2027-03-01','finals_ends_on','2027-03-07',
    'registration_opens_at',now()+interval '1 day','registration_closes_at',now()+interval '2 days',
    'registration_fee_cents',1500));
  perform public.platform_admin_save_tournament_configuration(c,t,jsonb_build_object(
    'resource_ids',jsonb_build_array('71000000-0000-0000-0000-000000000002'),
    'series',jsonb_build_array(jsonb_build_object('name','CI series','capacity',8,'enabled',true)),
    'play_windows',jsonb_build_array(jsonb_build_object('weekday',1,'opens_at','18:00','closes_at','20:00'))));
  s := (public.platform_admin_get_tournament(c,t)->'series'->0->>'id')::uuid;
  insert into public.tournament_teams(tournament_id,series_id,status,contact_email)
    values(t,s,'accepted','player-b@test.local') returning id into team;
  update public.profiles set first_name='Fixture',last_name='Participant' where id=profile_id_value;
  update auth.users set email_confirmed_at=now() where id in (profile_id_value,other_profile);
  insert into public.tournament_external_player_identities(first_name,last_name,first_name_normalized,last_name_normalized)
    values('Fixture','Participant','fixture','participant') returning id into identity_id;
  insert into public.tournament_team_players(team_id,tournament_id,role,first_name,last_name,email,display_order,external_identity_id)
    values(team,t,'front','Fixture','Participant','player-b@test.local',0,identity_id),
          (team,t,'back','Fixture','Partner','partner@example.test',1,null);
  result := public.admin_list_tournament_account_audit_for_club(c,t);
  if jsonb_array_length(result)<>1 or result->0->>'status' is distinct from 'probable' then
    raise exception 'Unexpected audit result: %',result;
  end if;
  result := public.admin_search_tournament_account_candidates_for_club(c,t,identity_id,'Fixture');
  if jsonb_array_length(result)<>1 or result->0->>'id' is distinct from profile_id_value::text then
    raise exception 'Unexpected candidate result: %',result;
  end if;
  result := public.admin_search_tournament_account_candidates_for_club(c,t,identity_id,'player-a@test.local');
  if jsonb_array_length(result)<>0 then raise exception 'Unrelated profile exposed'; end if;
  begin
    perform public.admin_link_tournament_account_for_club(c,t,identity_id,other_profile);
    raise exception 'Unrelated profile accepted' using errcode='XX000';
  exception when invalid_parameter_value then null;
  end;
  update auth.users set email_confirmed_at=null where id=profile_id_value;
  begin
    perform public.admin_link_tournament_account_for_club(c,t,identity_id,profile_id_value);
    raise exception 'Unconfirmed profile accepted' using errcode='XX000';
  exception when invalid_parameter_value then null;
  end;
  update auth.users set email_confirmed_at=now() where id=profile_id_value;
  -- Create a second participation in club A in the isolated fixture.
  insert into public.tournaments(club_id,season_id,name,status,starts_on,ends_on,pool_starts_on,pool_ends_on,finals_starts_on,finals_ends_on,registration_opens_at,registration_closes_at)
  values ('00000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','CI shared identity','preparation','2027-02-01','2027-03-07','2027-02-01','2027-02-28','2027-03-01','2027-03-07',now()+interval '1 day',now()+interval '2 days')
  returning id into foreign_tournament;
  insert into public.tournament_series(tournament_id,name,capacity,display_order,enabled)
  values(foreign_tournament,'CI shared series',8,0,true) returning id into foreign_series;
  insert into public.tournament_teams(tournament_id,series_id,status,contact_email)
  values(foreign_tournament,foreign_series,'accepted','player-b@test.local') returning id into foreign_team;
  insert into public.tournament_team_players(team_id,tournament_id,role,first_name,last_name,email,display_order,external_identity_id)
  values(foreign_team,foreign_tournament,'front','Fixture','Participant','player-b@test.local',0,identity_id);
  begin
    perform public.admin_link_tournament_account_for_club(c,t,identity_id,profile_id_value);
    raise exception 'Shared unresolved identity accepted' using errcode='XX000';
  exception when insufficient_privilege then null;
  end;
  if exists(select 1 from public.tournament_external_player_identities where id=identity_id and profile_id is not null) then
    raise exception 'Rejected shared identity link changed account';
  end if;
  begin
    perform public.admin_list_tournament_account_audit_for_club(c,foreign_tournament);
    raise exception 'Foreign tournament audit accepted' using errcode='XX000';
  exception when no_data_found then null;
  end;
  begin
    perform public.admin_search_tournament_account_candidates_for_club(c,foreign_tournament,identity_id,'Fixture');
    raise exception 'Foreign tournament search accepted' using errcode='XX000';
  exception when no_data_found then null;
  end;
  delete from public.tournament_team_players where team_id=foreign_team;
  result := public.admin_link_tournament_account_for_club(c,t,identity_id,profile_id_value);
  if result->>'linked' is distinct from 'true' then raise exception 'Link failed'; end if;
  result := public.admin_list_tournament_account_audit_for_club(c,t);
  if result->0->>'status' is distinct from 'recognized' then raise exception 'Linked identity not recognized'; end if;
  if not exists(select 1 from public.tournament_external_player_identities i where i.id=identity_id and i.profile_id=profile_id_value and i.status='verified') then
    raise exception 'Link not persisted';
  end if;
end $check$;
rollback;
