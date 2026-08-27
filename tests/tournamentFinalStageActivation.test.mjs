import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildFinalStagePlan,
  finalStageSeedOrder,
} from "../.test-dist/src/features/tournaments/domain/finalStageEngine.js";
import { getFinalStageEncouragement } from "../.test-dist/src/features/tournaments/domain/finalStageEncouragement.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const activationMigration =
  "../supabase/migrations/20260822100000_activate_tournament_final_stage.sql";
const hardeningMigration =
  "../supabase/migrations/20260822101000_harden_tournament_final_stage_activation.sql";
const exposureMigration =
  "../supabase/migrations/20260822102000_expose_tournament_final_matches.sql";
const notificationMigration =
  "../supabase/migrations/20260822103000_final_stage_notifications_and_replanning.sql";
const notificationIsolationMigration =
  "../supabase/migrations/20260822103100_isolate_final_stage_notification_failures.sql";
const unpublishArchiveFixMigration =
  "../supabase/migrations/20260822103200_fix_final_stage_unpublish_archived_at.sql";

test("la génération réelle reprend exactement le seeding déjà validé", () => {
  assert.deepEqual(
    finalStageSeedOrder(16),
    [1, 16, 8, 9, 4, 13, 5, 12, 3, 14, 6, 11, 7, 10, 2, 15],
  );
  const plan = buildFinalStagePlan(24);
  assert.equal(plan.directEntryCount, 8);
  assert.deepEqual(
    plan.preliminaryMatches.map(({ seedA, seedB }) => [seedA, seedB]),
    [
      [9, 24],
      [10, 23],
      [11, 22],
      [12, 21],
      [13, 20],
      [14, 19],
      [15, 18],
      [16, 17],
    ],
  );
});

test("la base ne génère jamais les finales avant validation complète des poules", async () => {
  const migration = await read(activationMigration);
  assert.match(
    migration,
    /Every pool match must have a validated result before finals/,
  );
  assert.match(
    migration,
    /Tournament qualification cutoff contains an unresolved tie/,
  );
  assert.match(migration, /tournament_general_ranking_rows/);
  assert.match(migration, /tournament_final_seeds/);
});

test("les matchs finaux utilisent uniquement les créneaux et disponibilités finals", async () => {
  const migration = await read(activationMigration);
  assert.match(migration, /generated\.phase = 'finals'/);
  assert.match(
    migration,
    /Tournament finals planning violates team availability/,
  );
  assert.match(migration, /admin_save_tournament_final_planning/);
  assert.match(migration, /admin_publish_tournament_final_round/);
  assert.match(migration, /sync_event_occupations/);
});

test("le seeding est figé après génération", async () => {
  const migration = await read(hardeningMigration);
  assert.match(
    migration,
    /Tournament qualifier count is locked after finals generation/,
  );
  assert.match(migration, /Pool results are locked after finals generation/);
  assert.match(migration, /before update of finals_qualifier_count/);
});

test("les espaces admin et joueur acceptent les matchs sans poule", async () => {
  const [migration, adminService, myService, myPage] = await Promise.all([
    read(exposureMigration),
    read(
      "../src/features/admin/tournaments/services/tournamentResultsAdminService.ts",
    ),
    read(
      "../src/features/user-space/tournaments/services/myTournamentsService.ts",
    ),
    read("../src/features/user-space/tournaments/pages/MyTournamentsPage.tsx"),
  ]);
  assert.match(migration, /left join public\.tournament_pools/);
  assert.match(migration, /event\.publication_status = 'published'/);
  assert.match(adminService, /phase: "pools" \| "finals"/);
  assert.match(myService, /finalRound: string \| null/);
  assert.match(myPage, /getFinalStageEncouragement/);
  assert.match(myPage, /Barrage/);
});

test("publication et rappels couvrent réellement les phases finales", async () => {
  const migration = await read(notificationMigration);
  assert.match(migration, /final_round_published/);
  assert.match(migration, /tournament_final_match_publication_notification/);
  assert.match(migration, /left join public\.tournament_pools/);
  assert.match(migration, /publish_tournament_match_day_reminder/);
  assert.match(migration, /publish_tournament_match_result_reminder/);
  assert.match(migration, /tournament_final_round_label/);
});

test("une panne de notification ne bloque jamais la publication finale", async () => {
  const migration = await read(notificationIsolationMigration);
  assert.match(migration, /notify_tournament_final_match_publication/);
  assert.match(migration, /exception when others then/);
  assert.match(migration, /target_match\.team_a_id/);
  assert.match(migration, /target_match\.team_b_id/);
  assert.match(migration, /return new/);
});

test("l admin peut modifier le planning global puis publier le tour jouable", async () => {
  const [migration, service, component, fullPlanning] = await Promise.all([
    read(notificationMigration),
    read(
      "../src/features/admin/tournaments/services/tournamentFinalStageAdminService.ts",
    ),
    read(
      "../src/features/admin/tournaments/components/AdminTournamentFinalStageControl.tsx",
    ),
    read(
      "../src/features/admin/tournaments/components/AdminTournamentFinalFullPlanning.tsx",
    ),
  ]);
  assert.match(migration, /admin_unpublish_tournament_final_round/);
  assert.match(migration, /publication_status = 'archived'/);
  assert.match(migration, /sync_event_occupations/);
  assert.match(service, /admin_get_tournament_final_full_planning_workspace/);
  assert.match(service, /admin_save_tournament_final_full_planning/);
  assert.match(fullPlanning, /Planning complet des phases finales/);
  assert.match(fullPlanning, /Modifier manuellement/);
  assert.match(fullPlanning, /validateFullFinalStagePlanning/);
  assert.match(component, /Publier le tour et notifier les joueurs/);
  assert.match(component, /Retirer du calendrier pour modifier/);
});

test("le retrait d un tour archive aussi la date de l événement", async () => {
  const migration = await read(unpublishArchiveFixMigration);
  assert.match(migration, /admin_unpublish_tournament_final_round/);
  assert.match(migration, /publication_status = 'archived'/);
  assert.match(
    migration,
    /archived_at = coalesce\(event\.archived_at, now\(\)\)/,
  );
  assert.match(migration, /sync_event_occupations/);
});

test("un grand tableau dispose aussi de son encouragement stable", () => {
  const first = getFinalStageEncouragement({
    round: "round_of_32",
    state: "pre_match",
    stableKey: "final-match-32",
  });
  const second = getFinalStageEncouragement({
    round: "round_of_32",
    state: "pre_match",
    stableKey: "final-match-32",
  });
  assert.equal(first, second);
  assert.ok(first.length > 10);
});
