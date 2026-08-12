import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildRoundRobinMatches,
  generatePlanningProposal,
  hasDuplicateMatchPairs,
  planningMatchCountForPoolSize,
  validatePlanning,
} from "../.test-dist/src/features/tournaments/domain/planningEngine.js";

const pool = {
  id: "pool-a",
  seriesId: "series-1",
  displayOrder: 0,
  teamIds: ["a", "b", "c", "d"],
};

const makeSlot = (id, date, startsAt, endsAt, resourceId = "court-1") => ({
  id,
  resourceId,
  resourceName: resourceId,
  date,
  startsAt,
  endsAt,
});

const availabilityFor = (teamIds, slots) =>
  teamIds.map((teamId) => ({
    teamId,
    slots: slots.map(({ date, startsAt, endsAt }) => ({
      date,
      startsAt,
      endsAt,
    })),
  }));

test("une poule genere exactement une rencontre par paire d equipes", () => {
  assert.equal(planningMatchCountForPoolSize(4), 6);
  assert.equal(planningMatchCountForPoolSize(5), 10);
  assert.equal(planningMatchCountForPoolSize(6), 15);

  const matches = buildRoundRobinMatches([pool]);
  assert.equal(matches.length, 6);
  assert.equal(hasDuplicateMatchPairs(matches), false);
  assert.deepEqual(
    new Set(matches.flatMap((match) => [match.teamAId, match.teamBId])),
    new Set(pool.teamIds),
  );
});

test("le moteur planifie tous les matchs quand les capacites suffisent", () => {
  const matches = buildRoundRobinMatches([pool]);
  const slots = [
    makeSlot("s1", "2026-09-01", "17:00:00", "18:00:00"),
    makeSlot("s2", "2026-09-01", "18:00:00", "19:00:00"),
    makeSlot("s3", "2026-09-02", "17:00:00", "18:00:00"),
    makeSlot("s4", "2026-09-02", "18:00:00", "19:00:00"),
    makeSlot("s5", "2026-09-03", "17:00:00", "18:00:00"),
    makeSlot("s6", "2026-09-03", "18:00:00", "19:00:00"),
  ];

  const proposal = generatePlanningProposal({
    matches,
    slots,
    availability: availabilityFor(pool.teamIds, slots),
    iterations: 25,
    random: () => 0.42,
  });

  assert.equal(proposal.unscheduledMatchIds.length, 0);
  assert.equal(proposal.assignments.length, 6);
  assert.equal(proposal.quality.completionRate, 100);
  assert.equal(proposal.quality.availabilityRate, 100);
  assert.equal(
    new Set(proposal.assignments.map((item) => item.slotId)).size,
    6,
  );
});

test("le repos minimal peut rendre une rencontre impossible a placer", () => {
  const matches = buildRoundRobinMatches([
    {
      id: "pool-b",
      seriesId: "series-1",
      displayOrder: 0,
      teamIds: ["a", "b", "c"],
    },
  ]);
  const slots = [
    makeSlot("s1", "2026-09-01", "17:00:00", "18:00:00"),
    makeSlot("s2", "2026-09-01", "18:00:00", "19:00:00"),
    makeSlot("s3", "2026-09-02", "17:00:00", "18:00:00"),
  ];

  const proposal = generatePlanningProposal({
    matches,
    slots,
    availability: availabilityFor(["a", "b", "c"], slots),
    minimumRestMinutes: 60,
    iterations: 20,
    random: () => 0.2,
  });

  assert.equal(proposal.assignments.length, 2);
  assert.equal(proposal.unscheduledMatchIds.length, 1);
  assert.equal(proposal.quality.completionRate, 67);
});

test("une absence de disponibilite commune produit un diagnostic explicite", () => {
  const matches = buildRoundRobinMatches([
    {
      id: "pool-c",
      seriesId: "series-1",
      displayOrder: 0,
      teamIds: ["a", "b"],
    },
  ]);
  const slotA = makeSlot("s1", "2026-09-01", "17:00:00", "18:00:00");
  const slotB = makeSlot("s2", "2026-09-02", "17:00:00", "18:00:00");

  const proposal = generatePlanningProposal({
    matches,
    slots: [slotA, slotB],
    availability: [
      { teamId: "a", slots: [slotA] },
      { teamId: "b", slots: [slotB] },
    ],
    iterations: 1,
  });

  assert.equal(proposal.assignments.length, 0);
  assert.equal(proposal.diagnostics[0]?.code, "no_common_availability");
});

test("la validation refuse un meme terrain et creneau utilise deux fois", () => {
  const matches = buildRoundRobinMatches([pool]).slice(0, 2);
  const slot = makeSlot("s1", "2026-09-01", "17:00:00", "18:00:00");
  const validation = validatePlanning({
    matches,
    slots: [slot],
    availability: availabilityFor(pool.teamIds, [slot]),
    assignments: [
      { matchId: matches[0].id, slotId: slot.id },
      { matchId: matches[1].id, slotId: slot.id },
    ],
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.diagnostics.length, 1);
});

test("la migration persiste les matchs et le planning sans publier le calendrier", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/20260811203500_add_tournament_planning_engine.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /create table public\.tournament_matches/i);
  assert.match(migration, /create table public\.tournament_match_planning/i);
  assert.match(migration, /admin_prepare_tournament_matches/i);
  assert.match(migration, /admin_save_tournament_planning/i);
  assert.match(migration, /status = 'planning_generated'/i);
  assert.doesNotMatch(migration, /calendar_occupations/i);
});

test("l atelier admin genere, controle et enregistre le planning", async () => {
  const page = await readFile(
    new URL(
      "../src/features/admin/tournaments/pages/AdminTournamentPlanningPage.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const routes = await readFile(
    new URL("../src/shared/config/routes.ts", import.meta.url),
    "utf8",
  );

  assert.match(page, /generatePlanningProposal/);
  assert.match(page, /validatePlanning/);
  assert.match(page, /Générer le planning/);
  assert.match(page, /Enregistrer le planning/);
  assert.match(
    routes,
    /adminTournamentPlanning:\s*"\/admin\/tournois\/planning"/,
  );
});
