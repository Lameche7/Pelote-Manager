import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildFinalStagePlanningNodes } from "../.test-dist/src/features/tournaments/domain/finalStagePlanningEngine.js";
import {
  generateFullFinalStagePlanning,
  validateFullFinalStagePlanning,
  finalRoundDateWindow,
  finalRoundAvailableSlots,
} from "../.test-dist/src/features/tournaments/domain/finalStageFullPlanningEngine.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const slot = (id, date, startsAt) => ({
  id,
  resourceId: "court-1",
  resourceName: "Trinquet",
  date,
  startsAt,
  endsAt: `${String(Number(startsAt.slice(0, 2)) + 1).padStart(2, "0")}:00`,
});

const slots = [
  slot("slot-1", "2026-09-01", "17:00"),
  slot("slot-2", "2026-09-01", "18:00"),
  slot("slot-3", "2026-09-02", "17:00"),
  slot("slot-4", "2026-09-03", "17:00"),
];

const availability = [
  { teamId: "A", slots: [slots[0]] },
  { teamId: "B", slots: [slots[1]] },
  { teamId: "C", slots: [slots[2], slots[3]] },
  { teamId: "D", slots: [slots[2], slots[3]] },
];

const planningNodes = [
  {
    id: "series-1:0:0",
    seriesId: "series-1",
    round: "preliminary",
    roundNumber: 0,
    displayOrder: 0,
    dependencyNodeIds: [],
    possibleTeamIds: ["A", "B"],
    possibleTeamLabels: ["Équipe A", "Équipe B"],
    actualMatchId: "match-p",
    teamAId: "A",
    teamALabel: "Équipe A",
    teamBId: "B",
    teamBLabel: "Équipe B",
    locked: false,
  },
  {
    id: "series-1:1:0",
    seriesId: "series-1",
    round: "semifinal",
    roundNumber: 1,
    displayOrder: 0,
    dependencyNodeIds: ["series-1:0:0"],
    possibleTeamIds: ["C", "D"],
    possibleTeamLabels: ["Équipe C", "Équipe D"],
    actualMatchId: null,
    teamAId: null,
    teamALabel: null,
    teamBId: null,
    teamBLabel: null,
    locked: false,
  },
];

test("un tableau à 6 prépare barrages, demies et finale dès le départ", () => {
  const seeds = Array.from({ length: 6 }, (_, index) => ({
    seed: index + 1,
    teamId: `team-${index + 1}`,
    teamLabel: `Équipe ${index + 1}`,
  }));
  const nodes = buildFinalStagePlanningNodes({
    seriesId: "series-6",
    qualifierCount: 6,
    seeds,
    actualMatches: [],
  });

  assert.deepEqual(
    nodes.map((node) => [node.round, node.roundNumber, node.displayOrder]),
    [
      ["preliminary", 0, 0],
      ["preliminary", 0, 1],
      ["semifinal", 1, 0],
      ["semifinal", 1, 1],
      ["final", 2, 0],
    ],
  );
});

test("un trou sur un barrage ne bloque pas une étape suivante qui reste planifiable", () => {
  const proposal = generateFullFinalStagePlanning({
    nodes: planningNodes,
    slots,
    availability,
    iterations: 1,
    random: () => 0,
  });

  assert.ok(proposal.unscheduledNodeIds.includes("series-1:0:0"));
  assert.ok(
    proposal.assignments.some(
      (assignment) => assignment.nodeId === "series-1:1:0",
    ),
  );
});

test("le manuel peut forcer un créneau hors disponibilités déclarées", () => {
  const forced = [
    { nodeId: "series-1:0:0", slotId: "slot-1" },
    { nodeId: "series-1:1:0", slotId: "slot-3" },
  ];

  const manual = validateFullFinalStagePlanning({
    nodes: planningNodes,
    slots,
    availability,
    assignments: forced,
    respectAvailability: false,
  });
  const automatic = validateFullFinalStagePlanning({
    nodes: planningNodes,
    slots,
    availability,
    assignments: forced,
    respectAvailability: true,
  });

  assert.equal(manual.valid, true);
  assert.equal(automatic.valid, false);
});

test("le manuel bloque toujours les doublons de terrain et l ordre des étapes", () => {
  const duplicate = validateFullFinalStagePlanning({
    nodes: planningNodes,
    slots,
    availability,
    assignments: [
      { nodeId: "series-1:0:0", slotId: "slot-3" },
      { nodeId: "series-1:1:0", slotId: "slot-3" },
    ],
    respectAvailability: false,
  });
  const reversed = validateFullFinalStagePlanning({
    nodes: planningNodes,
    slots,
    availability,
    assignments: [
      { nodeId: "series-1:0:0", slotId: "slot-4" },
      { nodeId: "series-1:1:0", slotId: "slot-3" },
    ],
    respectAvailability: false,
  });

  assert.equal(duplicate.valid, false);
  assert.equal(reversed.valid, false);
});

test("la migration persiste toute la grille et synchronise les vrais matchs", async () => {
  const migration = await read(
    "../supabase/migrations/20260827200000_full_final_stage_planning.sql",
  );

  assert.match(migration, /tournament_final_planning_nodes/);
  assert.match(migration, /admin_prepare_tournament_final_planning_grid/);
  assert.match(migration, /admin_get_tournament_final_full_planning_workspace/);
  assert.match(migration, /admin_save_tournament_final_full_planning/);
  assert.match(migration, /sync_tournament_final_planning_node_to_match/);
  assert.match(migration, /tournament_final_match_created_sync_planning/);
  assert.match(migration, /target_node\.source = 'manual'/);
});

test("l admin voit le planning complet et tous les créneaux en manuel", async () => {
  const [component, control] = await Promise.all([
    read(
      "../src/features/admin/tournaments/components/AdminTournamentFinalFullPlanning.tsx",
    ),
    read(
      "../src/features/admin/tournaments/components/AdminTournamentFinalStageControl.tsx",
    ),
  ]);

  assert.match(component, /Planning complet des phases finales/);
  assert.match(component, /Compléter automatiquement le planning/);
  assert.match(component, /Modifier manuellement/);
  assert.match(component, /À programmer/);
  assert.match(component, /sortedSlots\.map/);
  assert.match(component, /respectAvailability: false/);
  assert.doesNotMatch(component, /compatibleSlots/);
  assert.doesNotMatch(control, /Proposer automatiquement un planning/);
  assert.match(control, /Publier le tour et notifier les joueurs/);
});

test("Lourdes: barrages et huitièmes restent en novembre, jamais le 11 décembre", () => {
  const finalStart = "2026-11-16";
  const finalEnd = "2026-12-12";
  const rounds = [
    { ...planningNodes[0], id: "p", round: "preliminary", roundNumber: 0 },
    { ...planningNodes[1], id: "r16", round: "round_of_16", roundNumber: 1 },
    { ...planningNodes[1], id: "qf", round: "quarterfinal", roundNumber: 2 },
    { ...planningNodes[1], id: "sf", round: "semifinal", roundNumber: 3 },
    { ...planningNodes[1], id: "f", round: "final", roundNumber: 4 },
  ];
  assert.deepEqual(
    rounds.map((node) =>
      finalRoundDateWindow({
        node,
        nodes: rounds,
        finalsStartsOn: finalStart,
        finalsEndsOn: finalEnd,
      }),
    ),
    [
      { earliest: "2026-11-16", latest: "2026-11-20" },
      { earliest: "2026-11-21", latest: "2026-11-27" },
      { earliest: "2026-11-28", latest: "2026-12-04" },
      { earliest: "2026-12-05", latest: "2026-12-10" },
      { earliest: "2026-12-12", latest: "2026-12-12" },
    ],
  );

  const offeredSlots = [
    slot("good", "2026-11-23", "18:00"),
    slot("too-late", "2026-12-11", "18:00"),
  ];
  const target = rounds[1];
  const result = generateFullFinalStagePlanning({
    nodes: [target],
    slots: offeredSlots,
    availability: [
      { teamId: "C", slots: offeredSlots },
      { teamId: "D", slots: offeredSlots },
    ],
    finalsStartsOn: finalStart,
    finalsEndsOn: finalEnd,
    iterations: 1,
    random: () => 0,
  });
  assert.equal(result.assignments[0]?.slotId, "good");
  const invalid = validateFullFinalStagePlanning({
    nodes: [target],
    slots: offeredSlots,
    availability: [],
    assignments: [{ nodeId: target.id, slotId: "too-late" }],
    finalsStartsOn: finalStart,
    finalsEndsOn: finalEnd,
  });
  assert.equal(invalid.valid, false);
});

test("exception contrôlée : Brault et Quessette peuvent viser le 24 novembre sans 1/8 tardif", () => {
  const normal = slot("normal", "2026-11-19", "19:00");
  const exceptional = slot("exception", "2026-11-24", "19:00");
  const forbidden = slot("forbidden", "2026-12-11", "19:00");
  const barrage = {
    ...planningNodes[0],
    id: "barrage-brault-quesstte",
    seriesId: "lourdes-3",
    round: "preliminary",
    roundNumber: 0,
    possibleTeamIds: ["brault", "quessette"],
    teamAId: "brault",
    teamBId: "quessette",
  };
  const eighth = {
    ...planningNodes[1],
    id: "eight",
    seriesId: "lourdes-3",
    round: "round_of_16",
    roundNumber: 1,
    possibleTeamIds: ["brault", "quessette"],
  };
  const quarter = {
    ...eighth,
    id: "quarter",
    round: "quarterfinal",
    roundNumber: 2,
  };
  const semifinal = {
    ...eighth,
    id: "semifinal",
    round: "semifinal",
    roundNumber: 3,
  };
  const final = { ...eighth, id: "final", round: "final", roundNumber: 4 };
  const nodes = [barrage, eighth, quarter, semifinal, final];
  const availability = [
    { teamId: "brault", slots: [normal, exceptional, forbidden] },
    { teamId: "quessette", slots: [exceptional, forbidden] },
  ];
  const options = finalRoundAvailableSlots({
    node: barrage,
    nodes,
    slots: [normal, exceptional, forbidden],
    availability,
    finalsStartsOn: "2026-11-16",
    finalsEndsOn: "2026-12-12",
  });
  assert.deepEqual(options.normal, []);
  assert.deepEqual(
    options.candidates.map((s) => s.id),
    ["exception"],
  );
  assert.equal(options.exception, true);

  const proposal = generateFullFinalStagePlanning({
    nodes,
    slots: [normal, exceptional, forbidden],
    availability,
    finalsStartsOn: "2026-11-16",
    finalsEndsOn: "2026-12-12",
    iterations: 1,
    random: () => 0,
  });
  assert.ok(
    proposal.assignments.some(
      (a) => a.nodeId === barrage.id && a.slotId === "exception",
    ),
  );
  assert.ok(!proposal.assignments.some((a) => a.slotId === "forbidden"));

  const normalAvailable = finalRoundAvailableSlots({
    node: barrage,
    nodes,
    slots: [normal, exceptional],
    availability: [
      { teamId: "brault", slots: [normal, exceptional] },
      { teamId: "quessette", slots: [normal, exceptional] },
    ],
    finalsStartsOn: "2026-11-16",
    finalsEndsOn: "2026-12-12",
  });
  assert.equal(normalAvailable.exception, false);
  assert.deepEqual(
    normalAvailable.candidates.map((s) => s.id),
    ["normal"],
  );
});
