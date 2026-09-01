import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260901190000_tournament_reschedule_suggestions.sql",
    import.meta.url,
  ),
  "utf8",
);
const errebotRestrictionMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260901193000_restrict_errebot_reschedule_swaps_without_availability.sql",
    import.meta.url,
  ),
  "utf8",
);
const service = readFileSync(
  new URL(
    "../src/features/user-space/tournaments/services/tournamentRescheduleService.ts",
    import.meta.url,
  ),
  "utf8",
);
const component = readFileSync(
  new URL(
    "../src/features/user-space/tournaments/components/TournamentRescheduleSuggestions.tsx",
    import.meta.url,
  ),
  "utf8",
);
const myTournamentsPage = readFileSync(
  new URL(
    "../src/features/user-space/tournaments/pages/MyTournamentsPage.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("le moteur de report est en lecture seule et réservé à l'équipe du joueur", () => {
  assert.match(migration, /^begin;/m);
  assert.match(
    migration,
    /create or replace function public\.tournament_profile_can_act_for_team/,
  );
  assert.match(
    migration,
    /create or replace function public\.get_my_tournament_reschedule_options/,
  );
  assert.match(migration, /Tournament team cannot request this reschedule/);
  assert.match(migration, /Tournament match is not published/);
  assert.match(migration, /Tournament match already has a result/);
  assert.doesNotMatch(migration, /update public\.tournament_match_planning/);
  assert.doesNotMatch(
    migration,
    /delete from public\.tournament_match_planning/,
  );
  assert.match(migration, /commit;\s*$/);
});

test("un report protège les équipes qui ne sont pas à l'origine de la demande", () => {
  assert.match(migration, /other_teams_same_day_load_protected', true/);
  assert.match(
    migration,
    /opponent_target_other_matches\s*<= measured\.opponent_original_other_matches/,
  );
  assert.match(
    migration,
    /swap_a_target_other_matches\s*<= measured\.swap_a_original_other_matches/,
  );
  assert.match(
    migration,
    /swap_b_target_other_matches\s*<= measured\.swap_b_original_other_matches/,
  );
});

test("le repos n'est jamais une contrainte bloquante pour les reports", () => {
  assert.match(migration, /minimum_rest_enforced', false/);
  assert.match(migration, /requester_may_take_extra_same_day_match', true/);
  assert.doesNotMatch(migration, /minimum_rest_minutes/);
  assert.doesNotMatch(migration, /hasSufficientRest/);
});

test("les suggestions proposent d'abord les créneaux libres puis les échanges à deux matchs", () => {
  assert.match(migration, /'free_slots'/);
  assert.match(migration, /'kind', 'free_slot'/);
  assert.match(migration, /'swaps'/);
  assert.match(migration, /'kind', 'swap'/);
  assert.match(migration, /swap_match_id/);
  assert.match(
    migration,
    /requester_team_id not in \(other_match\.team_a_id, other_match\.team_b_id\)/,
  );
  assert.match(
    migration,
    /opponent_team_id not in \(other_match\.team_a_id, other_match\.team_b_id\)/,
  );
});

test("les occupations, chevauchements et disponibilités déclarées des autres équipes restent protégés", () => {
  assert.match(migration, /public\.calendar_occupations/);
  assert.match(
    migration,
    /occupation\.starts_at < candidate\.absolute_ends_at/,
  );
  assert.match(migration, /other_planning\.starts_at < candidate\.ends_at/);
  assert.match(migration, /opponent_declared_available/);
  assert.match(migration, /swap_a_declared_available/);
  assert.match(migration, /swap_b_declared_available/);
  assert.match(
    migration,
    /grant execute on function public\.get_my_tournament_reschedule_options\(uuid, uuid\)\s*to authenticated/,
  );
});

test("un tournoi Errebot sans disponibilités importées ne propose jamais d'échange", () => {
  assert.match(errebotRestrictionMigration, /^begin;/m);
  assert.match(
    errebotRestrictionMigration,
    /rename to get_my_tournament_reschedule_options_engine/,
  );
  assert.match(errebotRestrictionMigration, /public\.tournament_imports/);
  assert.match(errebotRestrictionMigration, /import_row\.source = 'errebot'/);
  assert.match(
    errebotRestrictionMigration,
    /public\.tournament_team_availability_slots/,
  );
  assert.match(
    errebotRestrictionMigration,
    /restrict_swaps := is_errebot_import and not has_imported_availability/,
  );
  assert.match(errebotRestrictionMigration, /'swaps_enabled', not restrict_swaps/);
  assert.match(
    errebotRestrictionMigration,
    /'availability_source'.*'unknown_from_errebot'/s,
  );
  assert.match(
    errebotRestrictionMigration,
    /jsonb_set\(result, '\{swaps\}', '\[\]'::jsonb, true\)/,
  );
  assert.match(
    errebotRestrictionMigration,
    /grant execute on function public\.get_my_tournament_reschedule_options\(uuid, uuid\)\s*to authenticated/,
  );
  assert.match(errebotRestrictionMigration, /commit;\s*$/);
});

test("Mes tournois expose une prévisualisation sans permettre encore de déplacer une partie", () => {
  assert.match(service, /get_my_tournament_reschedule_options/);
  assert.match(service, /requesterTeamId/);
  assert.match(service, /swapsEnabled/);
  assert.match(service, /unknown_from_errebot/);
  assert.match(myTournamentsPage, /canRequestReschedule/);
  assert.match(myTournamentsPage, /Demander un report/);
  assert.match(myTournamentsPage, /TournamentRescheduleSuggestions/);
  assert.match(component, /Créneaux libres/);
  assert.match(component, /Échanges de créneaux/);
  assert.match(component, /Errebot n’a pas fourni les créneaux choisis/);
  assert.match(component, /échanges de matchs sont désactivés/);
  assert.match(component, /seuls les créneaux réellement\s+libres sont proposés/);
  assert.match(component, /Aucun\s+temps de repos minimum/);
  assert.match(component, /protège les équipes qui ne demandent pas le report/);
  assert.match(component, /Cette étape est une prévisualisation/);
  assert.doesNotMatch(service, /update|delete|insert/i);
});
