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
const requestMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260901213000_tournament_reschedule_requests.sql",
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
const requestsPanel = readFileSync(
  new URL(
    "../src/features/user-space/tournaments/components/TournamentRescheduleRequestsPanel.tsx",
    import.meta.url,
  ),
  "utf8",
);
const adminPage = readFileSync(
  new URL(
    "../src/features/admin/tournaments/pages/AdminTournamentReschedulePage.tsx",
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

test("le moteur de suggestion reste en lecture seule et réservé à l'équipe du joueur", () => {
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
  assert.match(
    errebotRestrictionMigration,
    /'swaps_enabled', not restrict_swaps/,
  );
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

test("une demande fige uniquement une proposition encore valide sans déplacer le planning", () => {
  assert.match(
    requestMigration,
    /create table if not exists public\.tournament_reschedule_requests/,
  );
  assert.match(
    requestMigration,
    /create table if not exists public\.tournament_reschedule_approvals/,
  );
  assert.match(
    requestMigration,
    /public\.get_my_tournament_reschedule_options\(\s*target_match_id,\s*requester_team_id\s*\)/s,
  );
  assert.match(requestMigration, /proposal_snapshot/);
  assert.match(requestMigration, /proposal is no longer available/);
  assert.match(requestMigration, /where status in \('pending', 'approved'\)/);
  assert.doesNotMatch(
    requestMigration,
    /update public\.tournament_match_planning/,
  );
  assert.doesNotMatch(
    requestMigration,
    /delete from public\.tournament_match_planning/,
  );
});

test("un accord vaut pour une équipe et toutes les équipes concernées doivent répondre", () => {
  assert.match(requestMigration, /primary key \(request_id, team_id\)/);
  assert.match(
    requestMigration,
    /array\[requester_team_id, opponent_team_id\]/,
  );
  assert.match(requestMigration, /swap_team_a_id/);
  assert.match(requestMigration, /swap_team_b_id/);
  assert.match(
    requestMigration,
    /case when required_team_id = requester_team_id then 'approved' else 'pending' end/,
  );
  assert.match(
    requestMigration,
    /not exists \([\s\S]*remaining\.decision = 'pending'[\s\S]*\) then\s*next_status := 'approved'/,
  );
  assert.match(
    requestMigration,
    /public\.tournament_profile_can_act_for_team\(acting_team_id, auth\.uid\(\)\)/,
  );
});

test("les équipes sans compte relié restent visibles et ne sont jamais auto-validées", () => {
  assert.match(
    requestMigration,
    /create or replace function public\.tournament_team_app_actor_count/,
  );
  assert.match(requestMigration, /'app_actor_count'/);
  assert.match(requestsPanel, /aucun\s+compte Pelote Manager relié/);
  assert.match(adminPage, /aucun compte relié/);
  assert.match(
    adminPage,
    /ne considère pas ces équipes comme ayant donné\s+leur accord/,
  );
});

test("Mes tournois permet de créer et traiter une demande sans appliquer encore le déplacement", () => {
  assert.match(service, /create_my_tournament_reschedule_request/);
  assert.match(service, /get_my_tournament_reschedule_requests/);
  assert.match(service, /decide_my_tournament_reschedule_request/);
  assert.match(service, /cancel_my_tournament_reschedule_request/);
  assert.match(myTournamentsPage, /Demander un report/);
  assert.match(myTournamentsPage, /TournamentRescheduleRequestsPanel/);
  assert.match(component, /Demander ce créneau/);
  assert.match(component, /Demander cet échange/);
  assert.match(component, /Aucune partie\s+n’est déplacée à cette étape/);
  assert.match(requestsPanel, /Accepter/);
  assert.match(requestsPanel, /Refuser/);
  assert.match(requestsPanel, /Tous les accords sont réunis/);
});

test("le back-office possède un suivi dédié des reports sans bouton de forçage", () => {
  assert.match(requestMigration, /admin_list_tournament_reschedule_requests/);
  assert.match(adminPage, /Reports de parties/);
  assert.match(adminPage, /Prêt à appliquer/);
  assert.match(adminPage, /À contacter hors application/);
  assert.doesNotMatch(adminPage, /Forcer l’accord/);
  assert.doesNotMatch(adminPage, /Appliquer le report/);
});
