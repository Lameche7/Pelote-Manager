begin;

-- Un même joueur peut participer à plusieurs séries d'un même tournoi.
-- La protection anti-doublon reste valable à l'intérieur d'une même série.
--
-- Les fonctions concernées ont été créées dans des migrations historiques
-- volumineuses. On remplace ici uniquement les contrôles devenus trop larges,
-- en vérifiant explicitement que les fragments attendus existent avant toute
-- réécriture.

do $migration$
declare
  function_definition text;
  patched_definition text;
  old_fragment text := $old$
  if exists (
    select 1
    from public.tournament_team_players as player
    where player.tournament_id = target_tournament_id
      and player.member_id is not null
    group by player.member_id
    having count(distinct player.team_id) > 1
  ) then
    raise exception 'A verified member appears in more than one imported team'
      using errcode = '23505';
  end if;
$old$;
  new_fragment text := $new$
  if exists (
    select 1
    from public.tournament_team_players as player
    join public.tournament_teams as team
      on team.id = player.team_id
     and team.tournament_id = player.tournament_id
    where player.tournament_id = target_tournament_id
      and player.member_id is not null
    group by player.member_id, team.series_id
    having count(distinct player.team_id) > 1
  ) then
    raise exception 'A verified member appears in more than one team in the same series'
      using errcode = '23505';
  end if;
$new$;
begin
  function_definition := replace(
    pg_get_functiondef('public.admin_import_errebot_tournament(jsonb)'::regprocedure),
    chr(13),
    ''
  );

  if position(old_fragment in function_definition) = 0 then
    raise exception 'PR190: admin_import_errebot_tournament duplicate-player guard changed unexpectedly';
  end if;

  patched_definition := replace(function_definition, old_fragment, new_fragment);
  execute patched_definition;
end;
$migration$;

do $migration$
declare
  function_definition text;
  patched_definition text;
  old_identity_guard text := $old$
  if exists (
    select 1
    from public.tournament_team_players as affected_player
    where affected_player.external_identity_id = new.id
    group by affected_player.tournament_id
    having count(*) > 1
  ) then
    raise exception 'External identity appears more than once in the same tournament'
      using errcode = '23505';
  end if;
$old$;
  new_identity_guard text := $new$
  if exists (
    select 1
    from public.tournament_team_players as affected_player
    join public.tournament_teams as affected_team
      on affected_team.id = affected_player.team_id
     and affected_team.tournament_id = affected_player.tournament_id
    where affected_player.external_identity_id = new.id
    group by affected_player.tournament_id, affected_team.series_id
    having count(*) > 1
  ) then
    raise exception 'External identity appears more than once in the same tournament series'
      using errcode = '23505';
  end if;
$new$;
  old_account_guard text := $old$
  if exists (
    select 1
    from public.tournament_team_players as affected_player
    join public.tournament_team_players as other_player
      on other_player.tournament_id = affected_player.tournament_id
     and other_player.id <> affected_player.id
    join public.tournament_teams as other_team
      on other_team.id = other_player.team_id
     and other_team.status in ('pending', 'accepted')
    left join public.tournament_external_player_identities as other_identity
      on other_identity.id = other_player.external_identity_id
    where affected_player.external_identity_id = new.id
      and (
        (
          target_member.id is not null
          and other_player.member_id = target_member.id
        )
        or (
          target_profile.id is not null
          and other_identity.status = 'verified'
          and other_identity.profile_id = target_profile.id
        )
      )
  ) then
    raise exception 'Account already represents another player in this tournament'
      using errcode = '23505';
  end if;
$old$;
  new_account_guard text := $new$
  if exists (
    select 1
    from public.tournament_team_players as affected_player
    join public.tournament_teams as affected_team
      on affected_team.id = affected_player.team_id
     and affected_team.tournament_id = affected_player.tournament_id
    join public.tournament_team_players as other_player
      on other_player.tournament_id = affected_player.tournament_id
     and other_player.id <> affected_player.id
    join public.tournament_teams as other_team
      on other_team.id = other_player.team_id
     and other_team.tournament_id = affected_team.tournament_id
     and other_team.series_id = affected_team.series_id
     and other_team.status in ('pending', 'accepted')
    left join public.tournament_external_player_identities as other_identity
      on other_identity.id = other_player.external_identity_id
    where affected_player.external_identity_id = new.id
      and (
        (
          target_member.id is not null
          and other_player.member_id = target_member.id
        )
        or (
          target_profile.id is not null
          and other_identity.status = 'verified'
          and other_identity.profile_id = target_profile.id
        )
      )
  ) then
    raise exception 'Account already represents another player in this tournament series'
      using errcode = '23505';
  end if;
$new$;
begin
  function_definition := replace(
    pg_get_functiondef('public.sync_verified_external_identity_to_tournament_players()'::regprocedure),
    chr(13),
    ''
  );

  if position(old_identity_guard in function_definition) = 0 then
    raise exception 'PR190: external identity duplicate guard changed unexpectedly';
  end if;
  patched_definition := replace(function_definition, old_identity_guard, new_identity_guard);

  if position(old_account_guard in patched_definition) = 0 then
    raise exception 'PR190: external account duplicate guard changed unexpectedly';
  end if;
  patched_definition := replace(patched_definition, old_account_guard, new_account_guard);

  execute patched_definition;
end;
$migration$;

do $migration$
declare
  function_definition text;
  patched_definition text;
  old_fragment text := $old$
  if exists (
    select 1
    from public.tournament_team_players as selected_player
    join public.tournament_team_players as other_player
      on other_player.tournament_id = selected_player.tournament_id
     and other_player.id <> selected_player.id
    left join public.tournament_external_player_identities as other_identity
      on other_identity.id = other_player.external_identity_id
    where selected_player.external_identity_id = target_identity.id
      and (
        (
          other_identity.status = 'verified'
          and other_identity.profile_id = current_profile.id
        )
        or (
          current_profile.member_id is not null
          and other_player.member_id = current_profile.member_id
        )
      )
  ) then
    raise exception 'Account already represents another player in this tournament'
      using errcode = '23505';
  end if;
$old$;
  new_fragment text := $new$
  if exists (
    select 1
    from public.tournament_team_players as selected_player
    join public.tournament_teams as selected_team
      on selected_team.id = selected_player.team_id
     and selected_team.tournament_id = selected_player.tournament_id
    join public.tournament_team_players as other_player
      on other_player.tournament_id = selected_player.tournament_id
     and other_player.id <> selected_player.id
    join public.tournament_teams as other_team
      on other_team.id = other_player.team_id
     and other_team.tournament_id = selected_team.tournament_id
     and other_team.series_id = selected_team.series_id
    left join public.tournament_external_player_identities as other_identity
      on other_identity.id = other_player.external_identity_id
    where selected_player.external_identity_id = target_identity.id
      and (
        (
          other_identity.status = 'verified'
          and other_identity.profile_id = current_profile.id
        )
        or (
          current_profile.member_id is not null
          and other_player.member_id = current_profile.member_id
        )
      )
  ) then
    raise exception 'Account already represents another player in this tournament series'
      using errcode = '23505';
  end if;
$new$;
begin
  function_definition := replace(
    pg_get_functiondef('public.claim_external_participation(uuid)'::regprocedure),
    chr(13),
    ''
  );

  if position(old_fragment in function_definition) = 0 then
    raise exception 'PR190: claim_external_participation duplicate guard changed unexpectedly';
  end if;

  patched_definition := replace(function_definition, old_fragment, new_fragment);
  execute patched_definition;
end;
$migration$;

comment on function public.admin_import_errebot_tournament(jsonb) is
  'Importe un tournoi externe. Un joueur peut participer à plusieurs séries, mais pas à deux équipes d une même série.';

commit;
