begin;

-- PR209 — application automatique d'un report dès que le dernier accord est reçu.
-- Le moteur transactionnel existant reste la seule source de vérité : il refait
-- tous les contrôles de planning/calendrier au moment exact de l'application.

-- Le moteur d'application était jusque-là réservé à un administrateur. On
-- conserve ce droit, mais on autorise aussi un participant d'une demande déjà
-- approuvée à déclencher exactement le même moteur. Cette ouverture est
-- strictement limitée aux équipes concernées par la demande.
do $$
declare
  source_definition text;
  patched_definition text;
begin
  source_definition := pg_get_functiondef(
    'public.admin_apply_tournament_reschedule_request(uuid)'::regprocedure
  );
  source_definition := replace(source_definition, chr(13), '');

  patched_definition := replace(
    source_definition,
    'target_club_id uuid := public.admin_current_club_id();',
    E'target_club_id uuid;\n  caller_can_apply boolean := false;'
  );
  if patched_definition = source_definition then
    raise exception 'PR209 could not patch application declaration';
  end if;
  source_definition := patched_definition;

  patched_definition := replace(
    source_definition,
    E'begin\n  if not public.has_club_permission(target_club_id, ''tournaments.manage'') then\n    raise exception ''Forbidden'' using errcode = ''42501'';\n  end if;\n\n  select item.*',
    E'begin\n  if auth.uid() is null then\n    raise exception ''Authentication required'' using errcode = ''42501'';\n  end if;\n\n  select item.*'
  );
  if patched_definition = source_definition then
    raise exception 'PR209 could not replace admin-only application guard';
  end if;
  source_definition := patched_definition;

  patched_definition := replace(
    source_definition,
    E'  select item.*\n  into tournament\n  from public.tournaments as item\n  where item.id = request.tournament_id\n    and item.club_id = target_club_id\n  for update;\n\n  if tournament.id is null then\n    raise exception ''Tournament reschedule request is outside this club''\n      using errcode = ''42501'';\n  end if;',
    E'  select item.*\n  into tournament\n  from public.tournaments as item\n  where item.id = request.tournament_id\n  for update;\n\n  if tournament.id is null then\n    raise exception ''Tournament reschedule tournament not found''\n      using errcode = ''P0002'';\n  end if;\n\n  target_club_id := tournament.club_id;\n  caller_can_apply := public.has_club_permission(target_club_id, ''tournaments.manage'')\n    or exists (\n      select 1\n      from public.tournament_reschedule_approvals as approval\n      where approval.request_id = request.id\n        and public.tournament_profile_can_act_for_team(approval.team_id, auth.uid())\n    );\n\n  if not caller_can_apply then\n    raise exception ''Forbidden'' using errcode = ''42501'';\n  end if;'
  );
  if patched_definition = source_definition then
    raise exception 'PR209 could not replace club-scoped application guard';
  end if;

  execute patched_definition;
end;
$$;

-- Quand une équipe répond dans PILOTOKI, le dernier accord ne laisse plus la
-- demande au statut approved : le même appel applique immédiatement le report
-- et renvoie applied, ou stale si le créneau est devenu impossible.
do $$
declare
  source_definition text;
  patched_definition text;
begin
  source_definition := pg_get_functiondef(
    'public.decide_my_tournament_reschedule_request(uuid,uuid,text)'::regprocedure
  );
  source_definition := replace(source_definition, chr(13), '');

  patched_definition := replace(
    source_definition,
    '  next_status text;',
    E'  next_status text;\n  application_result jsonb;'
  );
  if patched_definition = source_definition then
    raise exception 'PR209 could not patch player decision declaration';
  end if;
  source_definition := patched_definition;

  patched_definition := replace(
    source_definition,
    E'  return next_status;\nend;',
    E'  if next_status = ''approved'' then\n    application_result := public.admin_apply_tournament_reschedule_request(request.id);\n    return coalesce(application_result->>''status'', next_status);\n  end if;\n\n  return next_status;\nend;'
  );
  if patched_definition = source_definition then
    raise exception 'PR209 could not patch player automatic application';
  end if;

  execute patched_definition;
end;
$$;

-- Même comportement lorsque le dernier accord est recueilli hors application
-- par l'administrateur pour une équipe qui ne possède pas encore de compte.
do $$
declare
  source_definition text;
  patched_definition text;
begin
  source_definition := pg_get_functiondef(
    'public.admin_record_tournament_reschedule_offline_decision(uuid,uuid,text,text)'::regprocedure
  );
  source_definition := replace(source_definition, chr(13), '');

  patched_definition := replace(
    source_definition,
    '  cleaned_note text := nullif(btrim(contact_note), '''');',
    E'  cleaned_note text := nullif(btrim(contact_note), '''');\n  application_result jsonb;'
  );
  if patched_definition = source_definition then
    raise exception 'PR209 could not patch offline decision declaration';
  end if;
  source_definition := patched_definition;

  patched_definition := replace(
    source_definition,
    E'  return next_status;\nend;',
    E'  if next_status = ''approved'' then\n    application_result := public.admin_apply_tournament_reschedule_request(target_request.id);\n    return coalesce(application_result->>''status'', next_status);\n  end if;\n\n  return next_status;\nend;'
  );
  if patched_definition = source_definition then
    raise exception 'PR209 could not patch offline automatic application';
  end if;

  execute patched_definition;
end;
$$;

commit;
