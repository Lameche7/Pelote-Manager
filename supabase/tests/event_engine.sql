begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users(id,email,aud,role) values
 ('10000000-0000-0000-0000-000000000001','event-admin@example.test','authenticated','authenticated'),
 ('10000000-0000-0000-0000-000000000002','responsible-a@example.test','authenticated','authenticated'),
 ('10000000-0000-0000-0000-000000000003','responsible-b@example.test','authenticated','authenticated');
update public.profiles set display_name=case id
 when '10000000-0000-0000-0000-000000000001' then 'Administrateur événements'
 when '10000000-0000-0000-0000-000000000002' then 'Fallback A'
 when '10000000-0000-0000-0000-000000000003' then 'Fallback B' end
where id in ('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003');
update public.profiles set role='admin' where id='10000000-0000-0000-0000-000000000001';
insert into public.clubs(id,name,slug) values
 ('20000000-0000-0000-0000-000000000001','Club test A','club-test-a'),
 ('20000000-0000-0000-0000-000000000002','Club test B','club-test-b');
insert into public.club_roles(id,club_id,key,name) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','administrator','Administrateur');
insert into public.club_role_permissions(role_id,permission_key) values
 ('30000000-0000-0000-0000-000000000001','events.manage'),
 ('30000000-0000-0000-0000-000000000001','reservations.manage');
insert into public.club_memberships(club_id,profile_id,role_id) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001');
insert into public.club_members(id,club_id,licence_number,last_name,first_name,season,is_active) values
 ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','EVENT-A','Durand','Alice','2026',true),
 ('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','EVENT-B','Martin','Bob','2026',true);
update public.profiles set member_id='40000000-0000-0000-0000-000000000001' where id='10000000-0000-0000-0000-000000000002';
update public.profiles set member_id='40000000-0000-0000-0000-000000000002' where id='10000000-0000-0000-0000-000000000003';
insert into public.reservable_resources(id,club_id,name,timezone,is_active) values
 ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Terrain A','Europe/Paris',true),
 ('50000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','Terrain B','Europe/Paris',true);
insert into public.event_types(id,club_id,name,color) values
 ('60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Stage test','#2563eb'),
 ('60000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','Stage autre club','#2563eb');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);

create temporary table event_test_state(id uuid);
select is((select count(*)::integer from public.admin_list_event_responsibles()),1,'le sélecteur isole les membres actifs du club courant');
select is((select name from public.admin_list_event_responsibles()),'Alice Durand','le sélecteur utilise le nom du registre club_members');
insert into event_test_state select public.admin_save_event(jsonb_build_object(
 'event_type_id','60000000-0000-0000-0000-000000000001','name','Réunion confidentielle',
 'starts_at','2026-07-15T08:00:00.000Z','ends_at','2026-07-15T10:00:00.000Z',
 'resource_ids',jsonb_build_array('50000000-0000-0000-0000-000000000001'),
 'responsible_profile_id','10000000-0000-0000-0000-000000000002',
 'is_blocking',true,'visibility','private','publication_status','published'));

select is((select count(*)::integer from public.events where id=(select id from event_test_state)),1,'crée un évènement');
select is((select responsible_profile_id from public.events where id=(select id from event_test_state)),'10000000-0000-0000-0000-000000000002'::uuid,'conserve le responsable du club');
select is((select count(*)::integer from public.calendar_occupations where occupation_type='club_event'),1,'publier crée une occupation');
select is((select title from public.calendar_occupations where occupation_type='club_event'),'Indisponible','un évènement privé expose uniquement un titre neutre');
set local role anon;
select is((select title from public.list_calendar_occupations('50000000-0000-0000-0000-000000000001','2026-07-15T00:00:00Z','2026-07-16T00:00:00Z')),'Indisponible','un visiteur anonyme ne récupère pas le titre privé');
reset role;
select throws_ok(format('select public.admin_update_calendar_block(%L,%L)',(select calendar_occupation_id from public.event_resources where event_id=(select id from event_test_state)),'Fuite'), 'P0002','Blocage manuel introuvable','ancienne RPC ne modifie pas un club_event');
select throws_ok(format('select public.admin_delete_calendar_block(%L)',(select calendar_occupation_id from public.event_resources where event_id=(select id from event_test_state))), 'P0002','Blocage manuel introuvable','ancienne RPC n’annule pas un club_event');

select lives_ok(format($sql$select public.admin_save_event(jsonb_build_object('id',%L,'event_type_id','60000000-0000-0000-0000-000000000001','name','Réunion membres','starts_at','2026-07-15T08:00:00.000Z','ends_at','2026-07-15T10:00:00.000Z','resource_ids',jsonb_build_array('50000000-0000-0000-0000-000000000001'),'responsible_profile_id','10000000-0000-0000-0000-000000000002','is_blocking',true,'visibility','members','publication_status','published'))$sql$,(select id from event_test_state)),'passe en visibilité membres sans libérer le terrain');
set local role anon;
select is((select title from public.list_calendar_occupations('50000000-0000-0000-0000-000000000001','2026-07-15T00:00:00Z','2026-07-16T00:00:00Z')),'Indisponible','un visiteur anonyme ne récupère pas le titre membres');
reset role;
select lives_ok(format($sql$select public.admin_save_event(jsonb_build_object('id',%L,'event_type_id','60000000-0000-0000-0000-000000000001','name','Réunion publique','starts_at','2026-07-15T08:00:00.000Z','ends_at','2026-07-15T10:00:00.000Z','resource_ids',jsonb_build_array('50000000-0000-0000-0000-000000000001'),'responsible_profile_id','10000000-0000-0000-0000-000000000002','is_blocking',true,'visibility','public','publication_status','published'))$sql$,(select id from event_test_state)),'modifie la visibilité');
select is((select title from public.calendar_occupations where occupation_type='club_event'),'Réunion publique','un évènement public expose son titre');
select lives_ok(format($sql$select public.admin_save_event(jsonb_build_object('id',%L,'event_type_id','60000000-0000-0000-0000-000000000001','name','Réunion publique','starts_at','2026-07-15T08:00:00.000Z','ends_at','2026-07-15T10:00:00.000Z','resource_ids',jsonb_build_array('50000000-0000-0000-0000-000000000001'),'responsible_profile_id','10000000-0000-0000-0000-000000000002','is_blocking',true,'visibility','public','publication_status','draft'))$sql$,(select id from event_test_state)),'dépublie l’évènement');
select is((select count(*)::integer from public.calendar_occupations where occupation_type='club_event'),0,'dépublier supprime l’occupation');
select throws_ok($sql$select public.admin_save_event(jsonb_build_object('event_type_id','60000000-0000-0000-0000-000000000001','name','Responsable externe','starts_at','2026-07-16T08:00:00Z','ends_at','2026-07-16T10:00:00Z','resource_ids',jsonb_build_array('50000000-0000-0000-0000-000000000001'),'responsible_profile_id','10000000-0000-0000-0000-000000000003'))$sql$,'22023','Le responsable doit être un membre actif du club','refuse le responsable d’un autre club');
select throws_ok($sql$select public.admin_save_event(jsonb_build_object('event_type_id','60000000-0000-0000-0000-000000000002','name','Type externe','starts_at','2026-07-16T08:00:00Z','ends_at','2026-07-16T10:00:00Z','resource_ids',jsonb_build_array('50000000-0000-0000-0000-000000000001')))$sql$,'22023','Invalid event type','refuse le type d’un autre club');
select lives_ok(format('select public.admin_archive_event(%L)',(select id from event_test_state)),'archive l’évènement');
select is((select publication_status::text from public.events where id=(select id from event_test_state)),'archived','l’archive reste conservée');
select is((select count(*)::integer from public.calendar_occupations where occupation_type='club_event'),0,'archiver ne recrée pas d’occupation');
select lives_ok(format('select public.admin_delete_event(%L)',(select id from event_test_state)),'supprime un évènement archivé');
select is((select count(*)::integer from public.events where id=(select id from event_test_state)),0,'la suppression nettoie l’évènement et ses relations');

select * from finish();
rollback;
