import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildCompatibilityMap,
  generateOptimizedPools,
  getPoolMetric,
  poolSizesFor,
  setPoolLock,
  swapPoolTeams,
} from "../.test-dist/src/features/tournaments/domain/poolEngine.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migrationPath =
  "../supabase/migrations/20260811103000_add_tournament_pool_engine.sql";

test("les séries sont découpées uniquement en poules de 4 ou 5", () => {
  assert.deepEqual(poolSizesFor(8), [4, 4]);
  assert.deepEqual(poolSizesFor(9), [4, 5]);
  assert.deepEqual(poolSizesFor(10), [5, 5]);
  assert.deepEqual(poolSizesFor(24), [4, 4, 4, 4, 4, 4]);
  assert.deepEqual(poolSizesFor(11), []);
});

test("la génération attribue chaque équipe une seule fois", () => {
  const teams = Array.from({ length: 8 }, (_, index) => ({
    id: `team-${index + 1}`,
    seriesId: "series-1",
  }));
  const generated = generateOptimizedPools({
    series: [{ id: "series-1", name: "1ère série", teams }],
    pairings: [],
    random: () => 0.42,
    iterationsPerSeries: 0,
  });

  assert.deepEqual(
    generated.map((pool) => pool.teams.length),
    [4, 4],
  );
  assert.equal(
    new Set(generated.flatMap((pool) => pool.teams.map((team) => team.teamId)))
      .size,
    8,
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
      isLocked: false,
      teams: ["a", "b", "c", "d"].map((teamId) => ({
        teamId,
        isLocked: false,
      })),
    },
    compatibility,
  );

  assert.equal(metric.minimum, 12);
  assert.equal(metric.pairCount, 6);
  assert.equal(metric.average, 119 / 6);
});

test("une équipe verrouillée ne peut pas être échangée", () => {
  const pools = [
    {
      key: "p1",
      seriesId: "s1",
      displayOrder: 0,
      targetSize: 4,
      isLocked: false,
      teams: [
        { teamId: "a", isLocked: true },
        { teamId: "b", isLocked: false },
        { teamId: "c", isLocked: false },
        { teamId: "d", isLocked: false },
      ],
    },
    {
      key: "p2",
      seriesId: "s1",
      displayOrder: 1,
      targetSize: 4,
      isLocked: false,
      teams: [
        { teamId: "e", isLocked: false },
        { teamId: "f", isLocked: false },
        { teamId: "g", isLocked: false },
        { teamId: "h", isLocked: false },
      ],
    },
  ];

  const swapped = swapPoolTeams(pools, "a", "e");
  assert.equal(swapped[0].teams[0].teamId, "a");
  assert.equal(swapped[1].teams[0].teamId, "e");
});

test("le verrou de poule ne transforme pas les verrous individuels", () => {
  const pools = [
    {
      key: "p1",
      seriesId: "s1",
      displayOrder: 0,
      targetSize: 4,
      isLocked: false,
      teams: [
        { teamId: "a", isLocked: false },
        { teamId: "b", isLocked: true },
        { teamId: "c", isLocked: false },
        { teamId: "d", isLocked: false },
      ],
    },
  ];

  const locked = setPoolLock(pools, "p1", true);
  const unlocked = setPoolLock(locked, "p1", false);
  assert.equal(unlocked[0].teams[0].isLocked, false);
  assert.equal(unlocked[0].teams[1].isLocked, true);
});

test("le rééquilibrage d’une poule verrouillée préserve les verrous individuels", () => {
  const teams = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => ({
    id,
    seriesId: "s1",
  }));
  const existingPools = [
    {
      key: "p1",
      seriesId: "s1",
      displayOrder: 0,
      targetSize: 4,
      isLocked: true,
      teams: [
        { teamId: "a", isLocked: false },
        { teamId: "b", isLocked: true },
        { teamId: "c", isLocked: false },
        { teamId: "d", isLocked: false },
      ],
    },
    {
      key: "p2",
      seriesId: "s1",
      displayOrder: 1,
      targetSize: 4,
      isLocked: false,
      teams: [
        { teamId: "e", isLocked: false },
        { teamId: "f", isLocked: false },
        { teamId: "g", isLocked: false },
        { teamId: "h", isLocked: false },
      ],
    },
  ];

  const generated = generateOptimizedPools({
    series: [{ id: "s1", name: "Série", teams }],
    pairings: [],
    existingPools,
    random: () => 0.4,
    iterationsPerSeries: 10,
  });
  const lockedPool = generated.find((pool) => pool.key === "p1");
  assert.ok(lockedPool);
  assert.equal(lockedPool.teams[0].isLocked, false);
  assert.equal(lockedPool.teams[1].isLocked, true);
  assert.equal(lockedPool.teams[2].isLocked, false);
});

test("la base sécurise le brouillon puis la validation", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /create table public\.tournament_pools/);
  assert.match(migration, /create table public\.tournament_pool_teams/);
  assert.match(migration, /admin_get_tournament_pool_workspace/);
  assert.match(migration, /admin_save_tournament_pools/);
  assert.match(migration, /admin_validate_tournament_pools/);
  assert.match(migration, /target_size in \(4, 5\)/);
  assert.match(
    migration,
    /Every accepted team must belong to exactly one pool/,
  );
  assert.match(migration, /status = 'pools_generated'/);
  assert.match(migration, /status = 'pools_validated'/);
});

test("l’atelier admin est interactif", async () => {
  const page = await read(
    "../src/features/admin/tournaments/pages/AdminTournamentPoolsPage.tsx",
  );

  assert.match(page, /Glissez une équipe sur une autre/);
  assert.match(page, /draggable=/);
  assert.match(page, /onDragStart/);
  assert.match(page, /Rééquilibrer les équipes libres/);
  assert.match(page, /Annuler les modifications/);
  assert.match(page, /Valider les poules/);
  assert.match(page, /Pire duel/);
});
