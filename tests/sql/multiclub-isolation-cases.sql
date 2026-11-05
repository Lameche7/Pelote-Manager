-- Tests d'intégration du cloisonnement multi-club dans une base PostgreSQL
-- éphémère de GitHub Actions. Données entièrement fictives.
-- Le schéma et les permissions viennent des fichiers fixture + migration réelle.
BEGIN;
DO $assert$
DECLARE
  n integer;
  foreign_count integer;
  err_state text;
BEGIN
  -- Le rôle JWT doit être réellement authenticated, pas postgres superutilisateur.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    RAISE EXCEPTION 'Missing authenticated role';
  END IF;
END
$assert$;

-- Administrateur du club A : lecture limitée à A, impossible de gérer B.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
DO $assert$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.list_profiles_for_admin();
  IF n<>3 THEN RAISE EXCEPTION 'A must see exactly 3 profiles, got %',n; END IF;
  IF EXISTS (
    SELECT 1 FROM public.list_profiles_for_admin()
    WHERE email IN ('admin-b@test.local','player-b@test.local')
  ) THEN RAISE EXCEPTION 'A can read B profiles'; END IF;

  BEGIN
    PERFORM public.set_profile_role(
      '20000000-0000-0000-0000-000000000004','admin'
    );
    RAISE EXCEPTION 'A promoted a profile belonging only to B';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.set_profile_role(
      '20000000-0000-0000-0000-000000000001','visitor'
    );
    RAISE EXCEPTION 'A changed own administrator status';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$assert$;

-- Administrateur du club B : contrôle symétrique, A invisible.
SELECT set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
DO $assert$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.list_profiles_for_admin();
  IF n<>3 THEN RAISE EXCEPTION 'B must see exactly 3 profiles, got %',n; END IF;
  IF EXISTS (
    SELECT 1 FROM public.list_profiles_for_admin()
    WHERE email IN ('admin-a@test.local','player-a@test.local')
  ) THEN RAISE EXCEPTION 'B can read A profiles'; END IF;

  BEGIN
    PERFORM public.set_profile_role(
      '20000000-0000-0000-0000-000000000003','admin'
    );
    RAISE EXCEPTION 'B promoted a profile belonging only to A';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$assert$;

-- Un joueur, même authentifié, ne reçoit aucun droit de gestion.
SELECT set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
DO $assert$
BEGIN
  BEGIN
    PERFORM public.list_profiles_for_admin();
    RAISE EXCEPTION 'Player unexpectedly read administrator directory';
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE 'P0003' THEN NULL;
  END;
  BEGIN
    PERFORM public.set_profile_role(
      '20000000-0000-0000-0000-000000000004','admin'
    );
    RAISE EXCEPTION 'Player unexpectedly promoted foreign account';
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE 'P0003' THEN NULL;
  END;
END
$assert$;

-- Le contrôle de doublon tient également au niveau du trigger SQL, même
-- lorsqu'une voie d'écriture tente d'ignorer l'interface.
RESET ROLE;
INSERT INTO public.club_memberships (
  club_id,profile_id,role_id
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001'
);
DO $assert$
BEGIN
  BEGIN
    INSERT INTO public.club_memberships (
      club_id,profile_id,role_id
    ) VALUES (
      '00000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000003',
      '10000000-0000-0000-0000-000000000002'
    );
    RAISE EXCEPTION 'Same person appointed administrator of two clubs';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$assert$;

-- Toute écriture et toutes les identités sont supprimées après le test.
ROLLBACK;
