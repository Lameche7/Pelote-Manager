import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildFinalStagePlanningNodes } from "../.test-dist/src/features/tournaments/domain/finalStagePlanningEngine.js";
import { describeFinalStageOpponents } from "../.test-dist/src/features/tournaments/domain/finalStageOpponentDescription.js";
import {
  automaticFinalPlanningSlots,
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
  assert.match(component, /Recalculer les rencontres connues/);
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

test("manual administrator override permits a late eighth while preserving automatic windows", async () => {
  const eighth = {
    ...planningNodes[0],
    id: "lourdes-eighth",
    round: "round_of_16",
    roundNumber: 1,
  };
  const late = slot("late", "2026-11-30", "21:30");
  const values = {
    nodes: [eighth],
    slots: [late],
    availability: [],
    assignments: [{ nodeId: eighth.id, slotId: late.id }],
    respectAvailability: false,
    finalsStartsOn: "2026-11-16",
    finalsEndsOn: "2026-12-12",
  };
  assert.equal(validateFullFinalStagePlanning(values).valid, false);
  assert.equal(
    validateFullFinalStagePlanning({
      ...values,
      allowManualRoundDateOverride: true,
    }).valid,
    true,
  );
  const component = await read(
    "../src/features/admin/tournaments/components/AdminTournamentFinalFullPlanning.tsx",
  );
  assert.match(component, /allowManualRoundDateOverride: true/);
  assert.match(component, /quickOutsideRoundWindow/);
  assert.match(component, /Confirmer cette dérogation administrateur/);
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

test("le moteur réaffecte les créneaux d'un tour sans doublon", () => {
  const early = slot("early", "2026-11-18", "17:00");
  const late = slot("late", "2026-11-19", "17:00");
  const template = planningNodes[0];
  const matches = [
    {
      ...template,
      id: "match-a",
      displayOrder: 0,
      teamAId: "A",
      teamBId: "B",
      possibleTeamIds: ["A", "B"],
    },
    {
      ...template,
      id: "match-b",
      displayOrder: 1,
      teamAId: "C",
      teamBId: "D",
      possibleTeamIds: ["C", "D"],
    },
  ];
  const proposed = generateFullFinalStagePlanning({
    nodes: matches,
    slots: [early, late],
    availability: [
      { teamId: "A", slots: [early, late] },
      { teamId: "B", slots: [early, late] },
      { teamId: "C", slots: [early] },
      { teamId: "D", slots: [early] },
    ],
    finalsStartsOn: "2026-11-16",
    finalsEndsOn: "2026-12-12",
    random: () => 0,
    iterations: 1,
  });
  assert.equal(proposed.assignments.length, 2);
  assert.equal(
    new Set(proposed.assignments.map((assignment) => assignment.slotId)).size,
    2,
  );
  assert.equal(
    proposed.assignments.find((assignment) => assignment.nodeId === "match-b")
      ?.slotId,
    "early",
  );
});

test("un tour futur inconnu réserve sans exiger la disponibilité de tous les vainqueurs possibles", () => {
  const future = {
    ...planningNodes[1],
    round: "semifinal",
    actualMatchId: null,
    possibleTeamIds: ["A", "B", "C", "D"],
  };
  const nextSlot = slot("future", "2026-12-07", "19:00");
  const available = finalRoundAvailableSlots({
    node: future,
    nodes: [future],
    slots: [nextSlot],
    availability: [],
    finalsStartsOn: "2026-11-16",
    finalsEndsOn: "2026-12-12",
  });
  assert.deepEqual(
    available.candidates.map((candidate) => candidate.id),
    ["future"],
  );
});

test("les finales ont des horaires explicitement ajoutés par un administrateur", async () => {
  const [migration, service, component] = await Promise.all([
    read("../supabase/migrations/20261114200000_final_event_slots.sql"),
    read(
      "../src/features/admin/tournaments/services/tournamentFinalStageAdminService.ts",
    ),
    read(
      "../src/features/admin/tournaments/components/AdminTournamentFinalFullPlanning.tsx",
    ),
  ]);
  assert.match(migration, /tournament_final_event_slots/);
  assert.match(migration, /admin_add_tournament_final_event_slot/);
  assert.match(migration, /tournament_generated_slots/);
  assert.match(migration, /has_club_permission/);
  assert.match(service, /async addFinalDaySlot/);
  assert.match(component, /Ajouter un créneau des finales/);
  assert.match(component, /Finale · horaire fixé, équipes à déterminer/);
});

test("la vue hebdomadaire expose les 7 jours, les parties et les vrais créneaux libres", async () => {
  const [calendar, admin, service, migration] = await Promise.all([
    read(
      "../src/features/admin/tournaments/components/AdminTournamentFinalWeeklyOverview.tsx",
    ),
    read(
      "../src/features/admin/tournaments/components/AdminTournamentFinalFullPlanning.tsx",
    ),
    read(
      "../src/features/admin/tournaments/services/tournamentFinalStageAdminService.ts",
    ),
    read(
      "../supabase/migrations/20261114223000_weekly_final_planning_occupied_slots.sql",
    ),
  ]);
  assert.match(calendar, /Array\.from\(\{ length: 7 \}/);
  assert.match(calendar, /Semaine précédente/);
  assert.match(calendar, /Semaine suivante/);
  assert.match(calendar, /Toutes les séries/);
  assert.match(calendar, /Créneaux libres uniquement/);
  assert.match(calendar, /Créneau occupé/);
  assert.match(calendar, /describeFinalStageOpponents/);
  assert.match(calendar, /Choisir ce créneau/);
  assert.match(calendar, /onSelectFreeSlot/);
  assert.match(admin, /Rencontres à programmer/);
  assert.match(admin, /quickOccupied/);
  assert.match(admin, /saveQuickAssignment/);
  assert.match(admin, /Créneaux conseillés/);
  assert.match(admin, /quickRecommendations/);
  assert.match(admin, /weeklyOccupiedSlotIds/);
  assert.match(admin, /minimumRestMinutes/);
  assert.match(admin, /finalRoundDateWindow/);
  assert.match(calendar, /focusDate/);
  assert.match(admin, /<AdminTournamentFinalWeeklyOverview/);
  assert.match(service, /admin_get_tournament_final_external_occupied_slots/);
  assert.match(service, /weeklyOccupiedSlotIds/);
  assert.match(migration, /public\.has_club_permission/);
  assert.match(migration, /public\.reservations/);
  assert.match(migration, /public\.tournament_match_planning/);
  assert.match(
    migration,
    /grant execute.*admin_get_tournament_final_external_occupied_slots/s,
  );
  assert.doesNotMatch(
    calendar,
    /saveFullPlanning|publishSeries|\.insert\(|\.update\(/,
  );
});

test("la case d'exclusion de 21h30 retire uniquement ces départs du calcul automatique", async () => {
  const early = slot("early", "2026-11-17", "20:30");
  const late = slot("late", "2026-11-17", "21:30");
  const offered = [early, late];
  assert.deepEqual(automaticFinalPlanningSlots(offered, false), offered);
  assert.deepEqual(automaticFinalPlanningSlots(offered, true), [early]);
  assert.equal(
    offered.length,
    2,
    "les créneaux sources ne doivent pas être modifiés",
  );

  const known = {
    ...planningNodes[0],
    id: "early-or-late",
    actualMatchId: "known",
    teamAId: "A",
    teamBId: "B",
  };
  const declared = [
    { teamId: "A", slots: offered },
    { teamId: "B", slots: offered },
  ];
  const excluded = generateFullFinalStagePlanning({
    nodes: [known],
    slots: offered,
    excludeStartsAt2130: true,
    availability: declared,
    iterations: 1,
    random: () => 0,
  });
  assert.equal(excluded.assignments[0]?.slotId, "early");
  const unrestricted = generateFullFinalStagePlanning({
    nodes: [known],
    slots: [late],
    excludeStartsAt2130: false,
    availability: declared,
    iterations: 1,
    random: () => 0,
  });
  assert.equal(unrestricted.assignments[0]?.slotId, "late");

  const fixedAt2130 = generateFullFinalStagePlanning({
    nodes: [known],
    slots: offered,
    availability: declared,
    existingAssignments: [{ nodeId: known.id, slotId: "late" }],
    fixedNodeIds: [known.id],
    excludeStartsAt2130: true,
    iterations: 1,
  });
  assert.deepEqual(fixedAt2130.assignments, [
    { nodeId: known.id, slotId: "late" },
  ]);

  const [component] = await Promise.all([
    read(
      "../src/features/admin/tournaments/components/AdminTournamentFinalFullPlanning.tsx",
    ),
  ]);
  assert.match(component, /useState\(false\)/);
  assert.match(component, /type="checkbox"/);
  assert.match(component, /Exclure les créneaux de 21h30/);
  assert.match(component, /excludeStartsAt2130: exclude2130/);
  assert.match(component, /row\.source === "manual"/);
  assert.match(component, /row\.published/);
});

test("l'export PDF du planning hebdomadaire conserve la semaine et les filtres en lecture seule", async () => {
  const calendar = await read(
    "../src/features/admin/tournaments/components/AdminTournamentFinalWeeklyOverview.tsx",
  );
  assert.match(calendar, /Exporter tout le planning en PDF/);
  assert.match(calendar, /index <= maxIndex/);
  assert.match(calendar, /slotsForDays\(weekDays\)/);
  assert.match(calendar, /filterSlots\(slotsForDays\(weekDays\)\)/);
  assert.match(calendar, /printed-week/);
  assert.match(calendar, /document\.body\.appendChild\(section\)/);
  assert.match(calendar, /@page \{ size: A3 landscape/);
  assert.match(calendar, /printWindow\.print\(\)/);
  assert.match(calendar, /seriesFilter/);
  assert.match(calendar, /show === "matches"/);
  assert.match(calendar, /role="alert"/);
  assert.doesNotMatch(
    calendar,
    /saveFullPlanning|publishSeries|\.insert\(|\.update\(/,
  );
});

test("les adversaires à confirmer sont décrits selon leur position réelle dans le tableau", async () => {
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
  const descriptions = nodes.map((node) =>
    describeFinalStageOpponents({ node, nodes, seeds }),
  );
  assert.equal(descriptions[0], "Équipe 3 — Équipe 6");
  assert.equal(descriptions[1], "Équipe 4 — Équipe 5");
  assert.match(descriptions[2], /Équipe 1/);
  assert.match(descriptions[2], /Vainqueur du barrage n°/);
  assert.match(descriptions[3], /Vainqueur du barrage n°/);
  assert.equal(
    descriptions[4],
    "Vainqueur de la demi-finale n°1 — Vainqueur de la demi-finale n°2",
  );

  const decided = buildFinalStagePlanningNodes({
    seriesId: "series-6",
    qualifierCount: 6,
    seeds,
    actualMatches: [
      {
        id: "decided",
        round: "semifinal",
        roundNumber: 1,
        displayOrder: 0,
        teamAId: "team-1",
        teamALabel: "Équipe 1",
        teamBId: "team-3",
        teamBLabel: "Équipe 3",
        resultStatus: null,
        published: false,
      },
    ],
  });
  assert.equal(
    describeFinalStageOpponents({ node: decided[2], nodes: decided, seeds }),
    "Équipe 1 — Équipe 3",
  );

  const calendar = await read(
    "../src/features/admin/tournaments/components/AdminTournamentFinalWeeklyOverview.tsx",
  );
  const detailed = await read(
    "../src/features/admin/tournaments/components/AdminTournamentFinalFullPlanning.tsx",
  );
  assert.match(calendar, /describeFinalStageOpponents/);
  assert.match(calendar, /document\.body\.appendChild\(section\)/);
  assert.match(detailed, /describeFinalStageOpponents/);
});

test("le planning croisé suit les mêmes barrages que le tableau sportif", async () => {
  const seeds = Array.from({ length: 6 }, (_, index) => ({
    seed: index + 1,
    teamId: `team-${index + 1}`,
    teamLabel: `Équipe ${index + 1}`,
  }));
  const crossed = buildFinalStagePlanningNodes({
    seriesId: "crossed",
    qualifierCount: 6,
    seeds,
    actualMatches: [],
    crossPools: true,
  });
  assert.deepEqual(crossed[2].dependencyNodeIds, ["crossed:0:0"]);
  assert.deepEqual(crossed[3].dependencyNodeIds, ["crossed:0:1"]);
  assert.deepEqual(crossed[4].dependencyNodeIds, [
    "crossed:1:0",
    "crossed:1:1",
  ]);

  const calendar = await read(
    "../src/features/admin/tournaments/components/AdminTournamentFinalWeeklyOverview.tsx",
  );
  const fullPlan = await read(
    "../src/features/admin/tournaments/components/AdminTournamentFinalFullPlanning.tsx",
  );
  const control = await read(
    "../src/features/admin/tournaments/components/AdminTournamentFinalStageControl.tsx",
  );
  assert.match(calendar, /crossPools: series.crossPools/);
  assert.match(fullPlan, /crossPools: series.crossPools/);
  assert.match(control, /Croiser les poules/);
  assert.match(control, /series.generated/);
});

test("un créneau manuel hors grille est conservé sans devenir candidat au recalcul", async () => {
  const saturday = {
    id: "court-1|2026-11-21|15:00|16:00",
    resourceId: "court-1",
    resourceName: "Trinquet",
    date: "2026-11-21",
    startsAt: "15:00",
    endsAt: "16:00",
  };
  const monday = {
    ...saturday,
    id: "court-1|2026-11-23|18:30|19:30",
    date: "2026-11-23",
    startsAt: "18:30",
    endsAt: "19:30",
  };
  const fixed = {
    ...planningNodes[0],
    id: "manual-saturday",
    round: "preliminary",
    roundNumber: 0,
    seriesId: "separate",
    actualMatchId: "manual-saturday",
    possibleTeamIds: ["A", "B"],
  };
  const other = {
    ...fixed,
    id: "free-match",
    actualMatchId: "free-match",
    possibleTeamIds: ["C", "D"],
    teamAId: "C",
    teamBId: "D",
  };
  const proposal = generateFullFinalStagePlanning({
    nodes: [fixed, other],
    slots: [saturday, monday],
    availability: [
      { teamId: "A", slots: [] },
      { teamId: "B", slots: [] },
      { teamId: "C", slots: [saturday, monday] },
      { teamId: "D", slots: [saturday, monday] },
    ],
    existingAssignments: [{ nodeId: "manual-saturday", slotId: saturday.id }],
    fixedNodeIds: ["manual-saturday"],
    nonCandidateSlotIds: [saturday.id],
    iterations: 1,
    random: () => 0,
  });
  assert.deepEqual(
    proposal.assignments.find(
      (assignment) => assignment.nodeId === "manual-saturday",
    ),
    { nodeId: "manual-saturday", slotId: saturday.id },
  );
  assert.equal(
    proposal.assignments.find(
      (assignment) => assignment.nodeId === "free-match",
    )?.slotId,
    monday.id,
  );
});

test("la saisie exceptionnelle autorise les dates hors créneaux avec contrôle de collisions et droits", async () => {
  const [component, service, migration] = await Promise.all([
    read(
      "../src/features/admin/tournaments/components/AdminTournamentFinalFullPlanning.tsx",
    ),
    read(
      "../src/features/admin/tournaments/services/tournamentFinalStageAdminService.ts",
    ),
    read(
      "../supabase/migrations/20261115134500_final_manual_exceptional_datetime.sql",
    ),
  ]);
  assert.match(component, /Choisir une autre date \/ heure/);
  assert.match(component, /type="date"/);
  assert.match(component, /type="time"/);
  assert.match(component, /setExceptionalManualSlot/);
  assert.match(component, /nonCandidateSlotIds: \[/);
  assert.match(component, /\.\.\.workspace\.exceptionalSlotIds/);
  assert.match(component, /\.\.\.reservedFinalSlots/);
  assert.match(service, /exceptionalSlotIds/);
  assert.match(service, /admin_set_tournament_final_manual_datetime/);
  assert.match(migration, /has_club_permission/);
  assert.match(migration, /calendar_occupations/);
  assert.match(migration, /tournament_match_planning/);
  assert.match(migration, /tournament_final_planning_nodes/);
  assert.match(migration, /sync_tournament_final_planning_node_to_match/);
  assert.match(migration, /Published or completed match cannot be moved/);
});

test("un barrage peut se jouer après un huitième indépendant mais avant son propre huitième", () => {
  const seeds = Array.from({ length: 24 }, (_, index) => ({
    seed: index + 1,
    teamId: `team-${index + 1}`,
    teamLabel: `Équipe ${index + 1}`,
  }));
  const nodes = buildFinalStagePlanningNodes({
    seriesId: "3me",
    qualifierCount: 24,
    seeds,
    actualMatches: [],
  });
  const barrage = nodes.find(
    (node) => node.roundNumber === 0 && node.displayOrder === 4,
  );
  const unrelatedEighth = nodes.find(
    (node) => node.roundNumber === 1 && node.displayOrder === 6,
  );
  const dependentEighth = nodes.find(
    (node) => node.roundNumber === 1 && node.displayOrder === 2,
  );
  assert.ok(barrage);
  assert.ok(unrelatedEighth);
  assert.ok(dependentEighth);
  assert.ok(!unrelatedEighth.dependencyNodeIds.includes(barrage.id));
  assert.ok(dependentEighth.dependencyNodeIds.includes(barrage.id));

  const before = {
    id: "tuesday-2030",
    resourceId: "trinquet",
    resourceName: "Lourdes",
    date: "2026-11-24",
    startsAt: "20:30",
    endsAt: "21:30",
  };
  const late = {
    ...before,
    id: "tuesday-2130",
    startsAt: "21:30",
    endsAt: "22:30",
  };
  const nextDay = {
    ...before,
    id: "wednesday-1730",
    date: "2026-11-25",
    startsAt: "17:30",
    endsAt: "18:30",
  };

  const independent = validateFullFinalStagePlanning({
    nodes: [barrage, unrelatedEighth],
    slots: [before, late],
    availability: [],
    assignments: [
      { nodeId: unrelatedEighth.id, slotId: before.id },
      { nodeId: barrage.id, slotId: late.id },
    ],
  });
  assert.equal(
    independent.valid,
    true,
    JSON.stringify(independent.diagnostics),
  );

  const dependentWrongOrder = validateFullFinalStagePlanning({
    nodes: [barrage, dependentEighth],
    slots: [before, late],
    availability: [],
    assignments: [
      { nodeId: dependentEighth.id, slotId: before.id },
      { nodeId: barrage.id, slotId: late.id },
    ],
  });
  assert.equal(dependentWrongOrder.valid, false);
  assert.ok(
    dependentWrongOrder.diagnostics.some(
      (entry) => entry.code === "invalid_assignment",
    ),
  );

  const dependentCorrectOrder = validateFullFinalStagePlanning({
    nodes: [barrage, dependentEighth],
    slots: [late, nextDay],
    availability: [],
    assignments: [
      { nodeId: barrage.id, slotId: late.id },
      { nodeId: dependentEighth.id, slotId: nextDay.id },
    ],
  });
  assert.equal(dependentCorrectOrder.valid, true);
});

test("les cartes de rattrapage privilégient les parties à deux adversaires connus sans changer le moteur automatique", async () => {
  const [admin, styles, service] = await Promise.all([
    read(
      "../src/features/admin/tournaments/components/AdminTournamentFinalFullPlanning.tsx",
    ),
    read(
      "../src/features/admin/tournaments/pages/AdminTournamentQualificationPage.css",
    ),
    read(
      "../src/features/admin/tournaments/services/tournamentFinalStageAdminService.ts",
    ),
  ]);
  assert.match(admin, /!persistedByNode\.has\(node\.id\)/);
  assert.match(admin, /row\?\.teamAId && row\?\.teamBId/);
  assert.match(admin, /queuePriority\(left\) - queuePriority\(right\)/);
  assert.match(admin, /disabled=\{busy \|\| !known\}/);
  assert.match(admin, /Adversaires en attente/);
  assert.match(admin, /Deux équipes connues/);
  assert.match(admin, /Le moteur attend les deux adversaires/);
  assert.match(admin, /final-stage-queue__card/);
  assert.match(styles, /\.final-stage-queue__card/);
  assert.match(styles, /var\(--series-color/);
  assert.match(service, /saveFullPlanning/);
});

test("TEMP FORMAT ADMIN FULL PLANNING", async () => {
  const prettier = await import("prettier");
  const filePath = new URL(
    "../src/features/admin/tournaments/components/AdminTournamentFinalFullPlanning.tsx",
    import.meta.url,
  );
  const original = await readFile(filePath, "utf8");
  const formatted = await prettier.format(original, { filepath: filePath.pathname });
  console.log("ADMIN628FMT_BEGIN:" + Buffer.from(formatted).toString("base64") + ":ADMIN628FMT_END");
});
