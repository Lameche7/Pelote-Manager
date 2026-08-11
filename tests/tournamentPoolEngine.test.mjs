import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildCompatibilityMap,
  generateOptimizedPools,
  getPoolMetric,
  movePoolTeam,
  poolSizeCountsFor,
  poolSizePlanIsValid,
  poolSizesFor,
  poolSizesFromCounts,
  swapPoolTeams,
} from "../.test-dist/src/features/tournaments/domain/poolEngine.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migrationPath =
  "../supabase/migrations/20260811103000_add_tournament_pool_engine.sql";
const upgradeMigrationPath =
  "../supabase/migrations/20260811114500_upgrade_tournament_pool_engine_adaptive.sql";

test("la proposition automatique privilegie les poules de 4", () => {
  assert.deepEqual(poolSizesFor(8), [4, 4]);
  assert.deepEqual(poolSizesFor(11), [5, 6]);
  assert.deepEqual(poolSizesFor(22), [4, 4, 4, 4, 6]);
  assert.deepEqual(poolSizesFor(23), [4, 4, 4, 5, 6]);
  assert.deepEqual(poolSizesFor(24), [4, 4, 4, 4, 4, 4]);
  assert.deepEqual(poolSizesFor(26), [4, 4, 4, 4, 4, 6]);
  assert.deepEqual(poolSizesFor(32), [4, 4, 4, 4, 4, 4, 4, 4]);
  assert.deepEqual(poolSizesFor(7), []);
});

test("la generation attribue chaque equipe une seule fois avec la proposition 4 prioritaire", () => {
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

test("l administrateur peut imposer une autre repartition 4 5 6 valide", () => {
  const teams = Array.from({ length: 32 }, (_, index) => ({
    id: `team-${index + 1}`,
    seriesId: "series-1",
    clubNames: [],
  }));
  const chosenSizes = [5, 5, 5, 5, 6, 6];
  const generated = generateOptimizedPools({
    series: [{ id: "series-1", name: "3eme serie", teams }],
    pairings: [],
    poolSizesBySeries: { "series-1": chosenSizes },
    random: () => 0.42,
    iterationsPerSeries: 0,
  });

  assert.deepEqual(
    generated.map((pool) => pool.teams.length),
    chosenSizes,
  );
  assert.equal(poolSizePlanIsValid(32, chosenSizes), true);
  assert.equal(poolSizePlanIsValid(32, [4, 4, 4]), false);
});

test("les compteurs admin se convertissent en tailles de poules", () => {
  const sizes = poolSizesFromCounts({ four: 3, five: 1, six: 1 });
  assert.deepEqual(sizes, [4, 4, 4, 5, 6]);
  assert.deepEqual(poolSizeCountsFor(sizes), { four: 3, five: 1, six: 1 });
  assert.equal(poolSizePlanIsValid(23, sizes), true);
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

test("un deplacement direct reste entre 4 et 6 equipes", () => {
  const pools = [
    {
      key: "p1",
      seriesId: "s1",
      displayOrder: 0,
      targetSize: 6,
      teams: ["a", "b", "c", "d", "e", "f"].map((teamId) => ({ teamId })),
    },
    {
      key: "p2",
      seriesId: "s1",
      displayOrder: 1,
      targetSize: 4,
      teams: ["g", "h", "i", "j"].map((teamId) => ({ teamId })),
    },
  ];

  const moved = movePoolTeam(pools, "a", "p2");
  assert.equal(moved[0].teams.length, 5);
  assert.equal(moved[1].teams.length, 5);
});

test("la base securise la composition 4 5 6 et permet de rouvrir", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /create table public\.tournament_pools/);
  assert.match(migration, /create table public\.tournament_pool_teams/);
  assert.match(migration, /admin_get_tournament_pool_workspace/);
  assert.match(migration, /admin_save_tournament_pools/);
  assert.match(migration, /admin_validate_tournament_pools/);
  assert.match(migration, /admin_reopen_tournament_pools/);
  assert.match(migration, /target_size in \(4, 5, 6\)/);
  assert.match(
    migration,
    /Every accepted team must belong to exactly one pool/,
  );
  assert.doesNotMatch(migration, /is_locked/);
});

test("une base ayant deja la premiere version PR70 est mise a niveau sans recreer les tables", async () => {
  const migration = await read(upgradeMigrationPath);

  assert.doesNotMatch(migration, /create table public\.tournament_pools/);
  assert.match(
    migration,
    /drop constraint if exists tournament_pools_target_size_check/,
  );
  assert.match(migration, /target_size in \(4, 5, 6\)/);
  assert.match(migration, /admin_save_tournament_pools/);
  assert.match(migration, /admin_validate_tournament_pools/);
  assert.match(migration, /admin_reopen_tournament_pools/);
});

test("l atelier admin propose et laisse choisir la repartition sans debordement horizontal", async () => {
  const [page, css] = await Promise.all([
    read("../src/features/admin/tournaments/pages/AdminTournamentPoolsPage.tsx"),
    read("../src/features/admin/tournaments/pages/AdminTournamentPoolsPage.css"),
  ]);

  assert.match(page, /privilégie les poules de 4/);
  assert.match(page, /Suggestion moteur/);
  assert.match(page, /Poules de 4/);
  assert.match(page, /Poules de 5/);
  assert.match(page, /Poules de 6/);
  assert.match(page, /Appliquer cette répartition/);
  assert.match(page, /Reprendre la suggestion/);
  assert.match(page, /draggable=/);
  assert.match(page, /Rouvrir les poules/);
  assert.match(css, /grid-template-columns:\s*repeat\(auto-fit/);
  assert.doesNotMatch(css, /grid-auto-flow:\s*column/);
  assert.doesNotMatch(page, /Verrouiller/);
});
