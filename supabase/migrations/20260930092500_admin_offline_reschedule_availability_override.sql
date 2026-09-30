begin;

do $patch$
declare
  source_definition text;
  patched_definition text;
begin
  source_definition := replace(
    pg_get_functiondef(
      'public.admin_apply_tournament_reschedule_request(uuid)'::regprocedure
    ),
    chr(13),
    ''
  );

  if position('manual_agreement_override boolean' in source_definition) = 0 then
    patched_definition := replace(
      source_definition,
      '  mutation_conflict boolean := false;',
      E'  mutation_conflict boolean := false;\n  manual_agreement_override boolean := false;'
    );
    source_definition := patched_definition;

    patched_definition := replace(
      source_definition,
      E'  if exists (\n    select 1\n    from public.tournament_reschedule_approvals as approval\n    where approval.request_id = request.id\n      and approval.decision <> ''approved''\n  ) then\n    raise exception ''Tournament reschedule request still misses an approval''\n      using errcode = ''P0001'';\n  end if;',
      E'  if exists (\n    select 1\n    from public.tournament_reschedule_approvals as approval\n    where approval.request_id = request.id\n      and approval.decision <> ''approved''\n  ) then\n    raise exception ''Tournament reschedule request still misses an approval''\n      using errcode = ''P0001'';\n  end if;\n\n  manual_agreement_override :=\n    coalesce((request.proposal_snapshot#>>''{policy,admin_manual}'')::boolean, false)\n    and exists (\n      select 1 from public.tournament_reschedule_approvals as approval\n      where approval.request_id = request.id\n        and approval.decision = ''approved''\n        and approval.decision_source = ''offline_admin''\n    );'
    );
    source_definition := patched_definition;

    source_definition := replace(
      source_definition,
      E'  if exists (\n    select 1 from public.tournament_team_availability_slots as availability\n    where availability.team_id = opponent_team_id',
      E'  if not manual_agreement_override and exists (\n    select 1 from public.tournament_team_availability_slots as availability\n    where availability.team_id = opponent_team_id'
    );

    source_definition := replace(
      source_definition,
      E'    if (\n      exists (\n        select 1 from public.tournament_team_availability_slots as availability\n        where availability.team_id = swap_team_a_id',
      E'    if not manual_agreement_override and (\n      exists (\n        select 1 from public.tournament_team_availability_slots as availability\n        where availability.team_id = swap_team_a_id'
    );

    execute source_definition;
  end if;
end;
$patch$;

commit;
