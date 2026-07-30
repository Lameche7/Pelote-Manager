begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users(id,email,aud,role) values
 ('81000000-0000-0000-0000-000000000001','members-manager@example.test','authenticated','authenticated'),
 ('81000000-0000-0000-0000-000000000002','tournaments-reader@example.test','authenticated','authenticated'),
 ('81000000-0000-0000-0000-000000000003','outsider@example.test','authenticated','authenticated');
insert into public.clubs(id,name,slug) values
 ('82000000-0000-0000-0000-000000000001','Club membres A','club-membres-a'),
 ('82000000-0000-0000-0000-000000000002','Club membres B','club-membres-b');
insert into public.club_roles(id,club_id,key,name) values
 ('83000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000001','administrator','Gestion membres'),
 ('83000000-0000-0000-0000-000000000002','82000000-0000-0000-0000-000000000002','tournament_manager','Lecture tournois');
insert into public.club_role_permissions(role_id,permission_key) values
 ('83000000-0000-0000-0000-000000000001','members.manage'),
 ('83000000-0000-0000-0000-000000000002','tournaments.manage');
insert into public.club_memberships(club_id,profile_id,role_id) values
 ('82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','83000000-0000-0000-0000-000000000001'),
 ('82000000-0000-0000-0000-000000000002','81000000-0000-0000-0000-000000000002','83000000-0000-0000-0000-000000000002');
insert into public.club_seasons(id,club_id,name,starts_on,ends_on,is_active) values
 ('84000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000001','2026-2027','2026-07-01','2027-06-30',true),
 ('84000000-0000-0000-0000-000000000002','82000000-0000-0000-0000-000000000002','2026-2027','2026-07-01','2027-06-30',true);
select set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);

select is(public.normalize_member_licence(' ab 00123 '),'AB00123','licence normalisée et zéros préservés');
select is(public.normalize_member_identity('D’Ár-cy'),'DARCY','identité normalisée');
select is(public.member_category('2018-01-01','2027-06-30'),'M10','limite M10');
select is(public.member_category('2017-01-01','2027-06-30'),'M12','limite M12');
select is(public.member_category('1982-01-01','2027-06-30'),'Vétéran A/B','limite vétéran');
select is(public.member_category('1972-01-01','2027-06-30'),'Vétéran Senior','limite vétéran senior');

create temporary table member_state(id uuid,updated_at timestamptz);
insert into member_state(id) select public.admin_create_member(jsonb_build_object('licenceNumber',' 001 234 ','lastName','Durand','firstName','Alice','birthDate','2000-01-01','gender','female','ranking','N1'));
update member_state set updated_at=(select updated_at from public.club_members where id=member_state.id);
select is((select licence_number_normalized from public.club_members where id=(select id from member_state)),'001234','création conserve la licence textuelle normalisée');
select is((select count(*)::integer from public.club_member_seasons where club_member_id=(select id from member_state)),1,'création atomique de la saison active');
select is((select ranking from public.club_member_seasons where club_member_id=(select id from member_state)),'N1','classement facultatif conservé');
select is((select category from public.club_member_seasons where club_member_id=(select id from member_state)),'Senior','catégorie calculée en base');
select ok(public.is_active_licensee((select id from public.profiles where id='81000000-0000-0000-0000-000000000001'))=false,'un compte non lié ne devient pas licencié implicitement');
select throws_ok($$insert into public.club_members(club_id,licence_number,last_name,first_name,birth_date,gender) values('82000000-0000-0000-0000-000000000002','001234','Autre','Personne','2001-01-01','male')$$,'23505',null,'unicité globale normalisée');
select throws_ok($$insert into public.club_members(club_id,licence_number,last_name,first_name,birth_date,gender) values('82000000-0000-0000-0000-000000000001','FUTURE','Test','Future','2999-01-01','female')$$,'23514',null,'date future refusée');
select throws_ok($$insert into public.club_members(club_id,licence_number,last_name,first_name,birth_date,gender) values('82000000-0000-0000-0000-000000000001','GENRE','Test','Genre','2000-01-01','other')$$,'23514',null,'sexe technique refusé');
select ok(exists(select 1 from public.club_member_audit_log where club_member_id=(select id from member_state) and action='manual_created'),'création auditée');
select lives_ok(format('select public.admin_set_member_active(%L,false,%L,%L)',(select id from member_state),(select updated_at from member_state),'doublon'),'désactivation verrouillée et motivée');
select is((select is_active from public.club_members where id=(select id from member_state)),false,'fiche désactivée sans supprimer la saison');
select is((select count(*)::integer from public.club_member_seasons where club_member_id=(select id from member_state)),1,'désactivation non destructive');

select set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000002',true);
select is((select count(*)::integer from public.admin_search_members_global(jsonb_build_object('search','001234'))),1,'tournaments.manage lit la recherche globale');
select is(((public.admin_get_member((select id from member_state)))->>'canEdit')::boolean,false,'club extérieur strictement en lecture seule');
select ok(exists(select 1 from public.club_member_access_log where club_member_id=(select id from member_state) and accessed_by='81000000-0000-0000-0000-000000000002'),'détail interclubs journalisé');
select throws_ok(format('select public.admin_set_member_active(%L,true,%L,%L)',(select id from member_state),(select updated_at from public.club_members where id=(select id from member_state)),'interclub'),'42501',null,'modification interclubs refusée');

select set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000001',true);
create temporary table import_state(id uuid);
insert into import_state select public.admin_create_member_import(jsonb_build_object('file_name','licencies.csv','file_size',120,'file_hash','functional-hash','encoding','utf-8','separator',';','mapping','{}'));
select lives_ok(format($q$select public.admin_validate_member_import(%L,'[{"lineNumber":2,"data":{"licenceNumber":"IMP-001","lastName":"Martin","firstName":"Bob","birthDate":"1999-01-01","gender":"male","email":"","phone":"","ranking":"N2"},"decision":{}}]'::jsonb)$q$,(select id from import_state)),'validation serveur fonctionnelle');
select is((select status::text from public.club_member_imports where id=(select id from import_state)),'validated','import validé seulement sans erreur bloquante');
select is((public.admin_execute_member_import((select id from import_state)))->>'status','completed','exécution atomique réussie');
select is((select created_count from public.club_member_imports where id=(select id from import_state)),1,'compteur de créations exact');
select is((select count(*)::integer from public.club_member_audit_log where import_id=(select id from import_state)),1,'import audité ligne par ligne');
select * from finish();
rollback;
