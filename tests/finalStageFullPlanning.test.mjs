import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildFinalStagePlanningNodes } from "../.test-dist/src/features/tournaments/domain/finalStagePlanningEngine.js";
import {
  generateFullFinalStagePlanning,
  validateFullFinalStagePlanning,
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
