import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildFinalStagePlan,
  finalStageSeedOrder,
} from "../.test-dist/src/features/tournaments/domain/finalStageEngine.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migrationPath =
  "../supabase/migrations/20260819130000_add_general_ranking_and_qualification_scenarios.sql";

test("un tableau de 16 respecte le seeding pelote attendu", () => {
  assert.deepEqual(
    finalStageSeedOrder(16),
    [1, 16, 8, 9, 4, 13, 5, 12, 3, 14, 6, 11, 7, 10, 2, 15],
  );

  const plan = buildFinalStagePlan(16);
  assert.equal(plan.mainBracketSize, 16);
  assert.equal(plan.directEntryCount, 16);
  assert.deepEqual(plan.preliminaryMatches, []);
  assert.deepEqual(
    plan.firstRoundMatches.map((match) => [
      match.sideA.kind === "seed" ? match.sideA.seed : null,
      match.sideB.kind === "seed" ? match.sideB.seed : null,
    ]),
    [
      [1, 16],
      [8, 9],
      [4, 13],
      [5, 12],
      [3, 14],
      [6, 11],
      [7, 10],
      [2, 15],
    ],
  );
});

test("24 qualifies donnent 8 exempts et 8 barrages", () => {
  const plan = buildFinalStagePlan(24);

  assert.equal(plan.mainBracketSize, 16);
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

  const firstRound = plan.firstRoundMatches.map((match) => [
    match.sideA.kind === "seed"
      ? `S${match.sideA.seed}`
      : `V${match.sideA.seedA}-${match.sideA.seedB}`,
    match.sideB.kind === "seed"
      ? `S${match.sideB.seed}`
      : `V${match.sideB.seedA}-${match.sideB.seedB}`,
  ]);

  assert.deepEqual(firstRound, [
    ["S1", "V16-17"],
    ["S8", "V9-24"],
    ["S4", "V13-20"],
    ["S5", "V12-21"],
    ["S3", "V14-19"],
    ["S6", "V11-22"],
    ["S7", "V10-23"],
    ["S2", "V15-18"],
  ]);
});

test("les autres nombres de qualifies utilisent la meme regle generique", () => {
  const twelve = buildFinalStagePlan(12);
  assert.equal(twelve.mainBracketSize, 8);
  assert.equal(twelve.directEntryCount, 4);
  assert.deepEqual(
    twelve.preliminaryMatches.map(({ seedA, seedB }) => [seedA, seedB]),
    [
      [5, 12],
      [6, 11],
      [7, 10],
      [8, 9],
    ],
  );

  const twenty = buildFinalStagePlan(20);
  assert.equal(twenty.mainBracketSize, 16);
  assert.equal(twenty.directEntryCount, 12);
  assert.deepEqual(
    twenty.preliminaryMatches.map(({ seedA, seedB }) => [seedA, seedB]),
    [
      [13, 20],
      [14, 19],
      [15, 18],
      [16, 17],
    ],
  );
});

test("la base stocke le nombre de qualifies et calcule un classement general normalise", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /finals_qualifier_count/);
  assert.match(migration, /get_tournament_general_rankings/);
  assert.match(
    migration,
    /ranking_points::numeric\s*\/ team_stats\.matches_played/,
  );
  assert.match(
    migration,
    /team_stats\.points_for - team_stats\.points_against[\s\S]*team_stats\.matches_played/,
  );
  assert.match(migration, /cutoff_tie/);
});

test("les scenarios exacts reutilisent le Result Engine et simulent tous les ecarts legaux", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /tournament_team_qualification_scenario/);
  assert.match(migration, /tournament_calculate_match_result/);
  assert.match(migration, /for margin in 1\.\.target_points/);
  assert.match(migration, /minimum_win_margin/);
  assert.match(migration, /Victoire obligatoire aujourd’hui avec au moins/);
  assert.match(migration, /depends_on_others/);
});

test("les interfaces exposent classement general et course a la qualification", async () => {
  const [publicBoard, myTournaments, adminService] = await Promise.all([
    read("../src/features/tournaments/components/TournamentResultsBoard.tsx"),
    read("../src/features/user-space/tournaments/pages/MyTournamentsPage.tsx"),
    read(
      "../src/features/admin/tournaments/services/tournamentQualificationAdminService.ts",
    ),
  ]);

  assert.match(publicBoard, /Classement général/);
  assert.match(publicBoard, /Qualification/);
  assert.match(myTournaments, /Course à la qualification/);
  assert.match(myTournaments, /qualification\.message/);
  assert.match(adminService, /admin_save_tournament_series_qualifiers/);
});
