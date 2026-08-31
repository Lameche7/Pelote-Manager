import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildCompatibilityMap,
  generateOptimizedPools,
  getPoolMetric,
  movePoolTeam,
  poolSizesAreValidFor,
  poolSizesFor,
  swapPoolTeams,
} from "../.test-dist/src/features/tournaments/domain/poolEngine.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migrationPath =
  "../supabase/migrations/20260811103000_add_tournament_pool_engine.sql";
const upgradeMigrationPath =
  "../supabase/migrations/20260811114500_upgrade_tournament_pool_engine_adaptive.sql";
const importFoundationMigrationPath =
  "../supabase/migrations/20260831100000_errebot_import_foundation.sql";

test("la proposition automatique privilegie au maximum les poules de 4 et garde les poules de 3 exceptionnelles", () => {
  assert.deepEqual(poolSizesFor(3), [3]);
  assert.deepEqual(poolSizesFor(7), [3, 4]);
  assert.deepEqual(poolSizesFor(8), [4, 4]);
  assert.deepEqual(poolSizesFor(10), [4, 6]);
  assert.deepEqual(poolSizesFor(11), [5, 6]);
  assert.deepEqual(poolSizesFor(22), [4, 4, 4, 4, 6]);
  assert.deepEqual(poolSizesFor(23), [4, 4, 4, 5, 6]);
  assert.deepEqual(poolSizesFor(24), [4, 4, 4, 4, 4, 4]);
  assert.deepEqual(poolSizesFor(26), [4, 4, 4, 4, 4, 6]);
  assert.deepEqual(poolSizesFor(32), [4, 4, 4, 4, 4, 4, 4, 4]);
});

test("une repartition admin doit utiliser 3 4 5 6 et couvrir toutes les equipes", () => {
  assert.equal(poolSizesAreValidFor(10, [3, 3, 4]), true);
  assert.equal(poolSizesAreValidFor(32, [4, 4, 4, 4, 4, 4, 4, 4]), true);
  assert.equal(poolSizesAreValidFor(32, [5, 5, 5, 5, 6, 6]), true);
  assert.equal(poolSizesAreValidFor(32, [4, 4, 4, 4, 5, 5]), false);
  assert.equal(poolSizesAreValidFor(32, [2, 6, 6, 6, 6, 6]), false);
});

test("la generation attribue chaque equipe une seule fois avec la proposition auto", () => {
  const teams = Array.from({ length: 23 }, (_, index) => ({
    id: `team-${index + 1}`,
    seriesId: "series-1",
    clubNames: [],
  }));
  const generated = generateOptimizedPools({
    series: [{ id: "series-1", name: "1ere serie", teams }],
    pairings: [],
    random: () => 0.42,
    iterationsPerSeries: 0,
  });

  assert.deepEqual(
    generated.map((pool) => pool.teams.length),
    [4, 4, 4, 5, 6],
  );
  assert.equal(
    new Set(generated.flatMap((pool) => pool.teams.map((team) => team.teamId)))
      .size,
    23,
  );
});

test("l administrateur peut imposer une repartition valide avec des poules de 3", () => {
  const teams = Array.from({ length: 10 }, (_, index) => ({
    id: `team-${index + 1}`,
    seriesId: "series-1",
    clubNames: [],
  }));
  const generated = generateOptimizedPools({
    series: [{ id: "series-1", name: "1re serie", teams }],
    pairings: [],
    poolSizesBySeries: {
      "series-1": [3, 3, 4],
    },
    random: () => 0.42,
    iterationsPerSeries: 0,
  });

  assert.deepEqual(
    generated.map((pool) => pool.teams.length),
    [3, 3, 4],
  );
});

test("une repartition admin invalide est refusee", () => {
  const teams = Array.from({ length: 32 }, (_, index) => ({
    id: `team-${index + 1}`,
    seriesId: "series-1",
    clubNames: [],
  }));

  assert.throws(
    () =>
      generateOptimizedPools({
        series: [{ id: "series-1", name: "3e serie", teams }],
        pairings: [],
        poolSizesBySeries: { "series-1": [4, 4, 4, 4] },
        iterationsPerSeries: 0,
      }),
    /répartition choisie/,
  );
});

test("les indicateurs utilisent le duel le plus contraint", () => {
  const compatibility = buildCompatibilityMap([
    { teamAId: "a", teamBId: "b", commonSlotCount: 30 },
    { teamAId: "a", teamBId: "c", commonSlotCount: 12 },
    { teamAId: "a", teamBId: "d", commonSlotCount: 18 },
    { teamAId: "b", teamBId: "c", commonSlotCount: 20 },
    { teamAId: "b", teamBId: "d", commonSlotCount: 24 },
    { teamAId: "c", teamBId: "d", commonSlotCount: 15 },
  ]);
  const metric = getPoolMetric(
    {
      key: "pool-1",
      seriesId: "series-1",
      displayOrder: 0,
      targetSize: 4,
      teams: ["a", "b", "c", "d"].map((teamId) => ({ teamId })),
    },
    compatibility,
  );

  assert.equal(metric.minimum, 12);
  assert.equal(metric.pairCount, 6);
  assert.equal(metric.average, 119 / 6);
});

test("deux equipes peuvent etre echangees entre poules de la meme serie", () => {
  const pools = [
    {
      key: "p1",
      seriesId: "s1",
      displayOrder: 0,
      targetSize: 4,
      teams: ["a", "b", "c", "d"].map((teamId) => ({ teamId })),
    },
    {
      key: "p2",
      seriesId: "s1",
      displayOrder: 1,
      targetSize: 4,
      teams: ["e", "f", "g", "h"].map((teamId) => ({ teamId })),
    },
  ];

  const swapped = swapPoolTeams(pools, "a", "e");
  assert.equal(swapped[0].teams[0].teamId, "e");
  assert.equal(swapped[1].teams[0].teamId, "a");
});

test("un deplacement direct reste entre 3 et 6 equipes", () => {
  const pools = [
    {
      key: "p1",
      seriesId: "s1",
      displayOrder: 0,
      targetSize: 4,
      teams: ["a", "b", "c", "d"].map((teamId) => ({ teamId })),
    },
    {
      key: "p2",
      seriesId: "s1",
      displayOrder: 1,
      targetSize: 5,
      teams: ["e", "f", "g", "h", "i"].map((teamId) => ({ teamId })),
    },
  ];

  const moved = movePoolTeam(pools, "a", "p2");
  assert.equal(moved[0].teams.length, 3);
  assert.equal(moved[1].teams.length, 6);
});

test("les migrations historiques restent lisibles et PR124 etend la base a 3 4 5 6", async () => {
  const [migration, upgradeMigration, foundationMigration] = await Promise.all([
    read(migrationPath),
    read(upgradeMigrationPath),
    read(importFoundationMigrationPath),
  ]);

  assert.match(migration, /create table public\.tournament_pools/);
  assert.match(migration, /create table public\.tournament_pool_teams/);
  assert.match(migration, /target_size in \(4, 5, 6\)/);
  assert.doesNotMatch(migration, /is_locked/);

  assert.doesNotMatch(
    upgradeMigration,
    /create table public\.tournament_pools/,
  );
  assert.match(
    upgradeMigration,
    /drop constraint if exists tournament_pools_target_size_check/,
  );
  assert.match(upgradeMigration, /target_size in \(4, 5, 6\)/);

  assert.match(foundationMigration, /target_size in \(3, 4, 5, 6\)/);
  assert.match(foundationMigration, /admin_save_tournament_pools/);
  assert.match(
    foundationMigration,
    /Every accepted team must belong to exactly one pool/,
  );
});

test("l atelier admin propose et laisse choisir la repartition", async () => {
  const [page, css] = await Promise.all([
    read(
      "../src/features/admin/tournaments/pages/AdminTournamentPoolsPage.tsx",
    ),
    read(
      "../src/features/admin/tournaments/pages/AdminTournamentPoolsPage.css",
    ),
  ]);

  assert.match(page, /privilégie les poules de 4/);
  assert.match(page, /Proposition automatique/);
  assert.match(page, /Poules de \{size\}/);
  assert.match(page, /Appliquer cette répartition/);
  assert.match(page, /Reprendre la proposition/);
  assert.match(page, /Régénérer la proposition auto/);
  assert.match(page, /Rouvrir les poules/);
  assert.match(page, /draggable=/);
  assert.match(page, /Pire duel|pire duel/);
  assert.doesNotMatch(page, /Verrouiller/);
  assert.match(css, /grid-template-columns: repeat\(auto-fit/);
  assert.doesNotMatch(css, /grid-auto-flow: column/);
  assert.doesNotMatch(css, /overflow-x: auto/);
});
