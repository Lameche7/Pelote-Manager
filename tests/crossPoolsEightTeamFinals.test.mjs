import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildFinalStagePlan } from "../src/features/tournaments/domain/finalStageEngine.ts";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261117104500_cross_pools_eight_team_qualifiers.sql",
    import.meta.url,
  ),
  "utf8",
);
const control = readFileSync(
  new URL(
    "../src/features/admin/tournaments/components/AdminTournamentFinalStageControl.tsx",
    import.meta.url,
  ),
  "utf8",
);

const pairings = (plan) =>
  plan.firstRoundMatches.map(({ sideA, sideB }) => [
    sideA.seed,
    sideB.seed,
  ]);

test("8 players: crossed quarters pair A1-B4, B2-A3, B1-A4, A2-B3", () => {
  const crossed = buildFinalStagePlan(8, true);
  assert.equal(crossed.preliminaryMatches.length, 0);
  assert.deepEqual(pairings(crossed), [
    [1, 8],
    [4, 5],
    [2, 7],
    [3, 6],
  ]);
  assert.deepEqual(pairings(buildFinalStagePlan(8)), [
    [1, 8],
    [4, 5],
    [3, 6],
    [7, 2],
  ]);
});

test("six-player women's crossed semis stay unchanged", () => {
  const plan = buildFinalStagePlan(6, true);
  assert.deepEqual(pairings(plan), [
    [1, 3],
    [2, 4],
  ]);
  assert.deepEqual(
    plan.preliminaryMatches.map(({ seedA, seedB }) => [seedA, seedB]),
    [[3, 6], [4, 5]],
  );
});

test("SQL seeding and admin choice match the client", () => {
  assert.match(migration, /array\[1,8,4,5,2,7,3,6\]/);
  assert.match(migration, /finals_qualifier_count in \(6,8\)/);
  assert.match(migration, /selected\.finals_qualifier_count not in \(6,8\)/);
  assert.match(migration, /Eight-team crossed bracket is locked after generation/);
  assert.match(migration, /validated_match_count <> pool_match_count/);
  assert.match(control, /\[6, 8\]\.includes\(series\.qualifierCount\)/);
  assert.match(control, /Aucun duel de la même poule au premier tour/);
});
