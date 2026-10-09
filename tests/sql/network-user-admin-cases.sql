BEGIN;
SELECT set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
DO $tests$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.list_profiles_for_admin();
  IF n <> 3 THEN RAISE EXCEPTION 'club A expected 3 profiles, got %', n; END IF;
  IF EXISTS (SELECT 1 FROM public.list_profiles_for_admin() WHERE email IN ('admin-b@test.local','player-b@test.local')) THEN
    RAISE EXCEPTION 'club A can list club B accounts';
  END IF;
  BEGIN
    PERFORM public.set_profile_role('20000000-0000-0000-0000-000000000004','admin');
    RAISE EXCEPTION 'foreign promotion incorrectly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM public.set_profile_role('20000000-0000-0000-0000-000000000003','admin');
  IF NOT EXISTS (SELECT 1 FROM public.club_memberships WHERE profile_id='20000000-0000-0000-0000-000000000003') THEN
    RAISE EXCEPTION 'promotion failed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id='20000000-0000-0000-0000-000000000003' AND role <> 'visitor') THEN
    RAISE EXCEPTION 'global role changed';
  END IF;
  BEGIN
    INSERT INTO public.club_memberships VALUES
      ('00000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'second club administrator incorrectly allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM public.set_profile_role('20000000-0000-0000-0000-000000000003','visitor');
  IF EXISTS (SELECT 1 FROM public.club_memberships WHERE profile_id='20000000-0000-0000-0000-000000000003') THEN
    RAISE EXCEPTION 'demotion failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.list_profiles_for_admin() WHERE email='multi-player@test.local') THEN
    RAISE EXCEPTION 'multiclub player missing';
  END IF;
END
$tests$;
ROLLBACK;
