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
