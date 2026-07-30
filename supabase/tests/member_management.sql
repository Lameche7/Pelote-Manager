begin;
create extension if not exists pgtap with schema extensions;
select plan(63);

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


-- Manual commands, concurrency and linked active licence.
select lives_ok(format($q$select public.admin_update_member(%L,'{"email":"alice@example.test","ranking":"N2"}'::jsonb,%L,null)$q$,(select id from member_state),(select updated_at from public.club_members where id=(select id from member_state))),'mise à jour manuelle et classement actif');
select is((select ranking from public.club_member_seasons where club_member_id=(select id from member_state)),'N2','classement mis à jour par la RPC');
select throws_ok(format($q$select public.admin_update_member(%L,'{"firstName":"Conflit"}'::jsonb,%L,null)$q$,(select id from member_state),(select updated_at from member_state)),'40001',null,'version obsolète refusée');
select lives_ok(format('select public.admin_correct_member_licence(%L,%L,%L,%L)',(select id from member_state),'001-235',(select updated_at from public.club_members where id=(select id from member_state)),'correction fédérale'),'correction de licence dédiée');
select is((select licence_number_normalized from public.club_members where id=(select id from member_state)),'001-235','correction conserve la même fiche');
select set_config('app.allow_profile_member_link','on',true);
update public.profiles set member_id=(select id from member_state) where id='81000000-0000-0000-0000-000000000001';
select is(public.is_active_licensee('81000000-0000-0000-0000-000000000001'),false,'fiche désactivée invalide immédiatement la licence');
select lives_ok(format('select public.admin_set_member_active(%L,true,%L,%L)',(select id from member_state),(select updated_at from public.club_members where id=(select id from member_state)),'retour confirmé'),'réactivation manuelle explicite');
select is(public.is_active_licensee('81000000-0000-0000-0000-000000000001'),true,'réactivation retrouve la saison licenciée');
select ok(exists(select 1 from public.club_member_audit_log where club_member_id=(select id from member_state) and action='manual_reactivated'),'réactivation auditée distinctement');
-- A club with no active season cannot create a member.
insert into public.clubs(id,name,slug) values('82000000-0000-0000-0000-000000000003','Club sans saison','club-sans-saison');
insert into public.club_roles(id,club_id,key,name) values('83000000-0000-0000-0000-000000000003','82000000-0000-0000-0000-000000000003','administrator','Sans saison');
insert into public.club_role_permissions(role_id,permission_key) values('83000000-0000-0000-0000-000000000003','members.manage');
insert into public.club_memberships(club_id,profile_id,role_id) values('82000000-0000-0000-0000-000000000003','81000000-0000-0000-0000-000000000003','83000000-0000-0000-0000-000000000003');
select set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000003',true);
select throws_ok($q$select public.admin_create_member('{"licenceNumber":"NO-SEASON","lastName":"Sans","firstName":"Saison","birthDate":"2000-01-01","gender":"male"}'::jsonb)$q$,'22023','Aucune saison active','création refusée sans saison active');
select set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000002',true);
select is((select count(*)::integer from public.admin_search_members_global(jsonb_build_object('search','001-235'))),1,'tournaments.manage lit la recherche globale');
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
select is((select count(*)::integer from public.club_member_audit_log where import_id=(select id from import_state)),2,'import et saison audités ligne par ligne');
select throws_ok(format('select public.admin_execute_member_import(%L)',(select id from import_state)),'55000',null,'double exécution interdite');
create temporary table unchanged_import(id uuid);
insert into unchanged_import select public.admin_create_member_import(jsonb_build_object('file_name','identique.csv','file_size',120,'file_hash','unchanged-hash','encoding','utf-8','separator',';','mapping','{}'));
select lives_ok(format($q$select public.admin_validate_member_import(%L,'[{"lineNumber":2,"data":{"licenceNumber":"IMP-001","lastName":"Martin","firstName":"Bob","birthDate":"1999-01-01","gender":"male","email":"","phone":"","ranking":"N2"},"decision":{}}]'::jsonb)$q$,(select id from unchanged_import)),'ligne identique validée');
select is((select planned_action from public.club_member_import_rows where import_id=(select id from unchanged_import)),'unchanged','ligne inchangée détectée côté PostgreSQL');
select is((public.admin_execute_member_import((select id from unchanged_import)))->>'status','completed','ligne inchangée exécutée sans modification');
select is((select unchanged_count from public.club_member_imports where id=(select id from unchanged_import)),1,'compteur inchangé exact');
select is((select executed_action from public.club_member_import_rows where import_id=(select id from unchanged_import)),'unchanged','action exécutée inchangée');
create temporary table duplicate_import(id uuid);
insert into duplicate_import select public.admin_create_member_import(jsonb_build_object('file_name','doublon.csv','file_size',120,'file_hash','duplicate-hash','encoding','utf-8','separator',';','mapping','{}'));
select lives_ok(format($q$select public.admin_validate_member_import(%L,'[{"lineNumber":2,"data":{"licenceNumber":"DUP-1","lastName":"Un","firstName":"Test","birthDate":"1990-01-01","gender":"male"},"decision":{}},{"lineNumber":3,"data":{"licenceNumber":"DUP-1","lastName":"Deux","firstName":"Test","birthDate":"1991-01-01","gender":"female"},"decision":{}}]'::jsonb)$q$,(select id from duplicate_import)),'doublons analysés sans écriture métier');
select is((select status::text from public.club_member_imports where id=(select id from duplicate_import)),'draft','doublon empêche la validation');
select is((select count(*)::integer from public.club_members where licence_number_normalized='DUP-1'),0,'doublon ne crée aucune fiche');



-- Reactivation through import keeps the previous state and a dedicated counter/audit.
update public.club_members set is_active=false where licence_number_normalized='IMP-001';
create temporary table reactivate_import(id uuid);
insert into reactivate_import select public.admin_create_member_import(jsonb_build_object('file_name','reactiver.csv','file_size',100,'file_hash','reactivate-hash','encoding','utf-8','separator',';','mapping','{}'));
select lives_ok(format($q$select public.admin_validate_member_import(%L,'[{"lineNumber":2,"data":{"licenceNumber":"IMP-001","lastName":"Martin","firstName":"Bob","birthDate":"1999-01-01","gender":"male","email":"","phone":"","ranking":"N2"},"decision":{"reactivate":true}}]'::jsonb)$q$,(select id from reactivate_import)),'réactivation validée après détection serveur');
select is((public.admin_execute_member_import((select id from reactivate_import)))->>'status','completed','réactivation exécutée');
select is((select reactivated_count from public.club_member_imports where id=(select id from reactivate_import)),1,'compteur de réactivation exact');
select ok(exists(select 1 from public.club_member_audit_log where import_id=(select id from reactivate_import) and action='import_reactivated'),'audit distinct de réactivation');
-- External licence, duplicate identity and sensitive changes are recomputed server-side.
insert into public.club_members(club_id,licence_number,last_name,first_name,birth_date,gender) values('82000000-0000-0000-0000-000000000002','EXT-1','Externe','Eve','1995-01-01','female');
create temporary table conflict_import(id uuid);
insert into conflict_import select public.admin_create_member_import(jsonb_build_object('file_name','externe.csv','file_size',100,'file_hash','external-hash','encoding','utf-8','separator',';','mapping','{}'));
select lives_ok(format($q$select public.admin_validate_member_import(%L,'[{"lineNumber":2,"data":{"licenceNumber":"EXT-1","lastName":"Externe","firstName":"Eve","birthDate":"1995-01-01","gender":"female"},"decision":{}}]'::jsonb)$q$,(select id from conflict_import)),'licence externe recalculée');
select is((select planned_action from public.club_member_import_rows where import_id=(select id from conflict_import)),'other_club','licence externe bloquée');
create temporary table identity_import(id uuid);
insert into identity_import select public.admin_create_member_import(jsonb_build_object('file_name','identite.csv','file_size',100,'file_hash','identity-hash','encoding','utf-8','separator',';','mapping','{}'));
select lives_ok(format($q$select public.admin_validate_member_import(%L,'[{"lineNumber":2,"data":{"licenceNumber":"OTHER-NUMBER","lastName":"Martin","firstName":"Bob","birthDate":"1999-01-01","gender":"male"},"decision":{}}]'::jsonb)$q$,(select id from identity_import)),'identité similaire recalculée');
select is((select planned_action from public.club_member_import_rows where import_id=(select id from identity_import)),'identity_conflict','identité sous autre licence bloquée');
create temporary table sensitive_import(id uuid);
insert into sensitive_import select public.admin_create_member_import(jsonb_build_object('file_name','sensible.csv','file_size',100,'file_hash','sensitive-hash','encoding','utf-8','separator',';','mapping','{}'));
select lives_ok(format($q$select public.admin_validate_member_import(%L,'[{"lineNumber":2,"data":{"licenceNumber":"IMP-001","lastName":"Martin","firstName":"Bob","birthDate":"1998-01-01","gender":"male"},"decision":{}}]'::jsonb)$q$,(select id from sensitive_import)),'changement sensible recalculé');
select is((select status::text from public.club_member_imports where id=(select id from sensitive_import)),'draft','confirmation sensible manquante bloque la validation');
-- A concurrent change on the second row rolls back the first row and returns failed.
create temporary table rollback_import(id uuid);
insert into rollback_import select public.admin_create_member_import(jsonb_build_object('file_name','rollback.csv','file_size',100,'file_hash','rollback-hash','encoding','utf-8','separator',';','mapping','{}'));
select lives_ok(format($q$select public.admin_validate_member_import(%L,'[{"lineNumber":2,"data":{"licenceNumber":"ROLLBACK-NEW","lastName":"Rollback","firstName":"Nouveau","birthDate":"2002-01-01","gender":"male"},"decision":{}},{"lineNumber":3,"data":{"licenceNumber":"IMP-001","lastName":"Martin","firstName":"Bob","birthDate":"1999-01-01","gender":"male"},"decision":{}}]'::jsonb)$q$,(select id from rollback_import)),'import multi-lignes validé');
update public.club_members set phone='concurrent' where licence_number_normalized='IMP-001';
select is((public.admin_execute_member_import((select id from rollback_import)))->>'status','failed','échec transactionnel retourné au client');
select is((select status::text from public.club_member_imports where id=(select id from rollback_import)),'failed','statut failed conservé');
select is((select count(*)::integer from public.club_members where licence_number_normalized='ROLLBACK-NEW'),0,'rollback supprime toute création partielle');
select set_config('app.allow_profile_member_link','off',true);
set local role authenticated;
select throws_ok($q$update public.club_member_audit_log set reason='altéré'$q$,'42501',null,'audit non modifiable depuis le navigateur');
select throws_ok($q$update public.profiles set member_id=null where id='81000000-0000-0000-0000-000000000001'$q$,'42501',null,'profiles.member_id protégé hors RPC');
reset role;
select lives_ok((select pg_get_functiondef('public.is_active_licensee(uuid,date)'::regprocedure)),'is_active_licensee existante peut être remplacée sans erreur');
select * from finish();
rollback;
