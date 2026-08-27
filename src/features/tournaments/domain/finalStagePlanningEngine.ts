import {
  buildFinalStagePlan,
  type FinalStageSeedSource,
} from "./finalStageEngine.js";
import type {
  PlanningSlot,
  TeamPlanningAvailability,
} from "./planningEngine.js";

export type FinalStagePlanningSeed = {
  seed: number;
  teamId: string;
  teamLabel: string;
};

export type FinalStagePlanningActualMatch = {
  id: string;
  round: string;
  roundNumber: number;
  displayOrder: number;
  teamAId: string;
  teamALabel: string;
  teamBId: string;
  teamBLabel: string;
  resultStatus: string | null;
  published: boolean;
};

export type FinalStagePlanningNode = {
  id: string;
  seriesId: string;
  round: string;
  roundNumber: number;
  displayOrder: number;
  dependencyNodeIds: string[];
  possibleTeamIds: string[];
  possibleTeamLabels: string[];
  actualMatchId: string | null;
  teamAId: string | null;
  teamALabel: string | null;
  teamBId: string | null;
  teamBLabel: string | null;
  locked: boolean;
};

export type FinalStagePlanningAssignment = {
  nodeId: string;
  slotId: string;
};

export type FinalStagePlanningDiagnostic = {
  nodeId: string;
  code:
    | "no_common_availability"
    | "dependency_unscheduled"
    | "capacity_conflict"
    | "invalid_assignment";
  message: string;
};

export type FinalStagePlanningProposal = {
  assignments: FinalStagePlanningAssignment[];
  unscheduledNodeIds: string[];
  diagnostics: FinalStagePlanningDiagnostic[];
};

export type FinalStagePlanningValidation = {
  valid: boolean;
  diagnostics: FinalStagePlanningDiagnostic[];
};

export const finalStagePlanningNodeId = (
  seriesId: string,
  roundNumber: number,
  displayOrder: number,
) => `${seriesId}:${roundNumber}:${displayOrder}`;

const roundKeyForBracketSize = (bracketSize: number) => {
  if (bracketSize === 2) return "final";
  if (bracketSize === 4) return "semifinal";
  if (bracketSize === 8) return "quarterfinal";
  if (bracketSize === 16) return "round_of_16";
  if (bracketSize === 32) return "round_of_32";
  return `round_of_${bracketSize}`;
};

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

const slotAvailabilityKey = (slot: {
  date: string;
  startsAt: string;
  endsAt: string;
}) => `${slot.date}|${slot.startsAt}|${slot.endsAt}`;

const timeToMinutes = (value: string) => {
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
};

const dateOrdinal = (date: string) => {
  const [year = "0", month = "1", day = "1"] = date.split("-");
  return Math.floor(
    Date.UTC(Number(year), Number(month) - 1, Number(day)) / 86_400_000,
  );
};

const slotRange = (slot: PlanningSlot) => {
  const day = dateOrdinal(slot.date) * 1_440;
  return {
    start: day + timeToMinutes(slot.startsAt),
    end: day + timeToMinutes(slot.endsAt),
  };
};

const actualMatchKey = (roundNumber: number, displayOrder: number) =>
  `${roundNumber}:${displayOrder}`;

const seedCandidates = (
  source: FinalStageSeedSource,
  seedByNumber: Map<number, FinalStagePlanningSeed>,
) => {
  const numbers =
    source.kind === "seed" ? [source.seed] : [source.seedA, source.seedB];
  const values = numbers
    .map((seedNumber) => seedByNumber.get(seedNumber))
    .filter((seed): seed is FinalStagePlanningSeed => Boolean(seed));
  return {
    teamIds: unique(values.map((seed) => seed.teamId)),
    teamLabels: unique(values.map((seed) => seed.teamLabel)),
  };
};

export const buildFinalStagePlanningNodes = ({
  seriesId,
  qualifierCount,
  seeds,
  actualMatches,
}: {
  seriesId: string;
  qualifierCount: number;
  seeds: FinalStagePlanningSeed[];
  actualMatches: FinalStagePlanningActualMatch[];
}): FinalStagePlanningNode[] => {
  if (qualifierCount < 2 || seeds.length < qualifierCount) return [];

  const plan = buildFinalStagePlan(qualifierCount);
  const seedByNumber = new Map(seeds.map((seed) => [seed.seed, seed]));
  const actualByPosition = new Map(
    actualMatches.map((match) => [
      actualMatchKey(match.roundNumber, match.displayOrder),
      match,
    ]),
  );
  const nodes: FinalStagePlanningNode[] = [];

  const makeNode = ({
    round,
    roundNumber,
    displayOrder,
    dependencyNodeIds,
    possibleTeamIds,
    possibleTeamLabels,
  }: {
    round: string;
    roundNumber: number;
    displayOrder: number;
    dependencyNodeIds: string[];
    possibleTeamIds: string[];
    possibleTeamLabels: string[];
  }) => {
    const actual = actualByPosition.get(
      actualMatchKey(roundNumber, displayOrder),
    );
    nodes.push({
      id: finalStagePlanningNodeId(seriesId, roundNumber, displayOrder),
      seriesId,
      round,
      roundNumber,
      displayOrder,
      dependencyNodeIds,
      possibleTeamIds: unique(possibleTeamIds),
      possibleTeamLabels: unique(possibleTeamLabels),
      actualMatchId: actual?.id ?? null,
      teamAId: actual?.teamAId ?? null,
      teamALabel: actual?.teamALabel ?? null,
      teamBId: actual?.teamBId ?? null,
      teamBLabel: actual?.teamBLabel ?? null,
      locked: Boolean(
        actual?.published || actual?.resultStatus === "validated",
      ),
    });
  };

  for (const preliminary of plan.preliminaryMatches) {
    const seedA = seedByNumber.get(preliminary.seedA);
    const seedB = seedByNumber.get(preliminary.seedB);
    makeNode({
      round: "preliminary",
      roundNumber: 0,
      displayOrder: preliminary.matchIndex - 1,
      dependencyNodeIds: [],
      possibleTeamIds: [seedA?.teamId ?? "", seedB?.teamId ?? ""],
      possibleTeamLabels: [seedA?.teamLabel ?? "", seedB?.teamLabel ?? ""],
    });
  }

  const sourceDependencies = (source: FinalStageSeedSource) =>
    source.kind === "preliminary_winner"
      ? [
          finalStagePlanningNodeId(
            seriesId,
            0,
            source.preliminaryMatchIndex - 1,
          ),
        ]
      : [];

  let previousRoundNodes: FinalStagePlanningNode[] = [];
  const firstRound = roundKeyForBracketSize(plan.mainBracketSize);
  for (const match of plan.firstRoundMatches) {
    const sideA = seedCandidates(match.sideA, seedByNumber);
    const sideB = seedCandidates(match.sideB, seedByNumber);
    makeNode({
      round: firstRound,
      roundNumber: 1,
      displayOrder: match.matchIndex - 1,
      dependencyNodeIds: [
        ...sourceDependencies(match.sideA),
        ...sourceDependencies(match.sideB),
      ],
      possibleTeamIds: [...sideA.teamIds, ...sideB.teamIds],
      possibleTeamLabels: [...sideA.teamLabels, ...sideB.teamLabels],
    });
  }
  previousRoundNodes = nodes.filter((node) => node.roundNumber === 1);

  let bracketSize = plan.mainBracketSize / 2;
  let roundNumber = 2;
  while (bracketSize >= 2) {
    const round = roundKeyForBracketSize(bracketSize);
    const nextRoundNodes: FinalStagePlanningNode[] = [];
    for (
      let displayOrder = 0;
      displayOrder < previousRoundNodes.length / 2;
      displayOrder += 1
    ) {
      const left = previousRoundNodes[displayOrder * 2];
      const right = previousRoundNodes[displayOrder * 2 + 1];
      if (!left || !right) continue;
      makeNode({
        round,
        roundNumber,
        displayOrder,
        dependencyNodeIds: [left.id, right.id],
        possibleTeamIds: [...left.possibleTeamIds, ...right.possibleTeamIds],
        possibleTeamLabels: [
          ...left.possibleTeamLabels,
          ...right.possibleTeamLabels,
        ],
      });
      const created = nodes[nodes.length - 1];
      if (created) nextRoundNodes.push(created);
    }
    previousRoundNodes = nextRoundNodes;
    bracketSize /= 2;
    roundNumber += 1;
  }

  return nodes;
};

const buildAvailabilityMap = (availability: TeamPlanningAvailability[]) =>
  new Map(
    availability.map((team) => [
      team.teamId,
      new Set(team.slots.map(slotAvailabilityKey)),
    ]),
  );

const requiredTeamIds = (node: FinalStagePlanningNode) =>
  node.actualMatchId && node.teamAId && node.teamBId
    ? [node.teamAId, node.teamBId]
    : node.possibleTeamIds;

export const isFinalStageSlotCommonForNode = ({
  node,
  slot,
  availability,
}: {
  node: FinalStagePlanningNode;
  slot: PlanningSlot;
  availability: TeamPlanningAvailability[];
}) => {
  const availabilityMap = buildAvailabilityMap(availability);
  const required = unique(requiredTeamIds(node));
  if (required.length === 0) return false;
  const key = slotAvailabilityKey(slot);
  return required.every((teamId) => availabilityMap.get(teamId)?.has(key));
};

const sharedPotentialTeam = (
  left: FinalStagePlanningNode,
  right: FinalStagePlanningNode,
) => {
  const rightTeams = new Set(requiredTeamIds(right));
  return requiredTeamIds(left).some((teamId) => rightTeams.has(teamId));
};

const gapIsValid = (
  left: PlanningSlot,
  right: PlanningSlot,
  minimumRestMinutes: number,
) => {
  const leftRange = slotRange(left);
  const rightRange = slotRange(right);
  const gap =
    rightRange.start >= leftRange.end
      ? rightRange.start - leftRange.end
      : leftRange.start >= rightRange.end
        ? leftRange.start - rightRange.end
        : -1;
  return gap >= minimumRestMinutes;
};

const dependencyOrderIsValid = (
  node: FinalStagePlanningNode,
  slot: PlanningSlot,
  assignmentByNode: Map<string, FinalStagePlanningAssignment>,
  nodeById: Map<string, FinalStagePlanningNode>,
  slotById: Map<string, PlanningSlot>,
  minimumRestMinutes: number,
) => {
  const candidate = slotRange(slot);
  for (const dependencyId of node.dependencyNodeIds) {
    const dependencyAssignment = assignmentByNode.get(dependencyId);
    const dependencyNode = nodeById.get(dependencyId);
    const dependencySlot = dependencyAssignment
      ? slotById.get(dependencyAssignment.slotId)
      : null;
    if (!dependencyNode || !dependencySlot) return false;
    const previous = slotRange(dependencySlot);
    if (candidate.start - previous.end < minimumRestMinutes) return false;
  }
  return true;
};

export const validateFinalStagePlanning = ({
  nodes,
  slots,
  availability,
  assignments,
  minimumRestMinutes = 0,
  respectAvailability = false,
}: {
  nodes: FinalStagePlanningNode[];
  slots: PlanningSlot[];
  availability: TeamPlanningAvailability[];
  assignments: FinalStagePlanningAssignment[];
  minimumRestMinutes?: number;
  respectAvailability?: boolean;
}): FinalStagePlanningValidation => {
  const diagnostics: FinalStagePlanningDiagnostic[] = [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const assignmentByNode = new Map<string, FinalStagePlanningAssignment>();
  const usedSlots = new Set<string>();

  for (const assignment of assignments) {
    const node = nodeById.get(assignment.nodeId);
    const slot = slotById.get(assignment.slotId);
    if (
      !node ||
      !slot ||
      assignmentByNode.has(assignment.nodeId) ||
      usedSlots.has(assignment.slotId)
    ) {
      diagnostics.push({
        nodeId: assignment.nodeId,
        code: "invalid_assignment",
        message: "Ce créneau crée un doublon ou n’existe plus.",
      });
      continue;
    }
    assignmentByNode.set(assignment.nodeId, assignment);
    usedSlots.add(assignment.slotId);
  }

  for (const assignment of assignments) {
    const node = nodeById.get(assignment.nodeId);
    const slot = slotById.get(assignment.slotId);
    if (!node || !slot) continue;

    if (
      respectAvailability &&
      !isFinalStageSlotCommonForNode({ node, slot, availability })
    ) {
      diagnostics.push({
        nodeId: node.id,
        code: "invalid_assignment",
        message: "Ce créneau n’est pas commun à toutes les équipes possibles.",
      });
      continue;
    }

    if (
      !dependencyOrderIsValid(
        node,
        slot,
        assignmentByNode,
        nodeById,
        slotById,
        minimumRestMinutes,
      )
    ) {
      diagnostics.push({
        nodeId: node.id,
        code: "invalid_assignment",
        message:
          "Ce créneau ne respecte pas l’ordre du tableau ou le repos après le tour précédent.",
      });
      continue;
    }

    for (const otherAssignment of assignments) {
      if (otherAssignment.nodeId === assignment.nodeId) continue;
      const otherNode = nodeById.get(otherAssignment.nodeId);
      const otherSlot = slotById.get(otherAssignment.slotId);
      if (!otherNode || !otherSlot || !sharedPotentialTeam(node, otherNode)) {
        continue;
      }
      if (!gapIsValid(slot, otherSlot, minimumRestMinutes)) {
        diagnostics.push({
          nodeId: node.id,
          code: "invalid_assignment",
          message:
            "Une même équipe pourrait être engagée sur deux parties trop proches.",
        });
        break;
      }
    }
  }

  return { valid: diagnostics.length === 0, diagnostics };
};

const commonSlotsForNode = (
  node: FinalStagePlanningNode,
  slots: PlanningSlot[],
  availability: TeamPlanningAvailability[],
) =>
  slots.filter((slot) =>
    isFinalStageSlotCommonForNode({ node, slot, availability }),
  );

const assignmentSignature = (assignments: FinalStagePlanningAssignment[]) =>
  [...assignments]
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId))
    .map((assignment) => `${assignment.nodeId}|${assignment.slotId}`)
    .join(";");

export const generateFullFinalStagePlanningProposal = ({
  nodes,
  slots,
  availability,
  existingAssignments = [],
  fixedNodeIds = [],
  minimumRestMinutes = 0,
  iterations = 300,
  random = Math.random,
}: {
  nodes: FinalStagePlanningNode[];
  slots: PlanningSlot[];
  availability: TeamPlanningAvailability[];
  existingAssignments?: FinalStagePlanningAssignment[];
  fixedNodeIds?: string[];
  minimumRestMinutes?: number;
  iterations?: number;
  random?: () => number;
}): FinalStagePlanningProposal => {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const fixed = new Set(fixedNodeIds);
  const commonSlots = new Map(
    nodes.map((node) => [
      node.id,
      commonSlotsForNode(node, slots, availability),
    ]),
  );
  let best: FinalStagePlanningProposal | null = null;

  const attempt = (): FinalStagePlanningProposal => {
    const assignments = existingAssignments.filter(
      (assignment) =>
        nodeById.has(assignment.nodeId) && slotById.has(assignment.slotId),
    );
    const assignmentByNode = new Map(
      assignments.map((assignment) => [assignment.nodeId, assignment]),
    );
    const usedSlots = new Set(
      assignments.map((assignment) => assignment.slotId),
    );
    const editable = nodes
      .filter((node) => !fixed.has(node.id) && !assignmentByNode.has(node.id))
      .sort((left, right) => {
        if (left.roundNumber !== right.roundNumber) {
          return left.roundNumber - right.roundNumber;
        }
        const slotDifference =
          (commonSlots.get(left.id)?.length ?? 0) -
          (commonSlots.get(right.id)?.length ?? 0);
        return slotDifference !== 0 ? slotDifference : random() - 0.5;
      });

    for (const node of editable) {
      if (
        node.dependencyNodeIds.some(
          (dependencyId) => !assignmentByNode.has(dependencyId),
        )
      ) {
        continue;
      }

      const candidates = (commonSlots.get(node.id) ?? [])
        .filter((slot) => !usedSlots.has(slot.id))
        .filter((slot) =>
          dependencyOrderIsValid(
            node,
            slot,
            assignmentByNode,
            nodeById,
            slotById,
            minimumRestMinutes,
          ),
        )
        .filter((slot) => {
          for (const accepted of assignments) {
            const otherNode = nodeById.get(accepted.nodeId);
            const otherSlot = slotById.get(accepted.slotId);
            if (
              !otherNode ||
              !otherSlot ||
              !sharedPotentialTeam(node, otherNode)
            ) {
              continue;
            }
            if (!gapIsValid(slot, otherSlot, minimumRestMinutes)) return false;
          }
          return true;
        })
        .sort((left, right) => {
          const leftRange = slotRange(left);
          const rightRange = slotRange(right);
          return leftRange.start - rightRange.start || random() - 0.5;
        });

      const candidate = candidates[0];
      if (!candidate) continue;
      const assignment = { nodeId: node.id, slotId: candidate.id };
      assignments.push(assignment);
      assignmentByNode.set(node.id, assignment);
      usedSlots.add(candidate.id);
    }

    const unscheduledNodeIds = nodes
      .filter((node) => !assignmentByNode.has(node.id))
      .map((node) => node.id);
    const diagnostics = unscheduledNodeIds.map((nodeId) => {
      const node = nodeById.get(nodeId);
      if (!node) {
        return {
          nodeId,
          code: "capacity_conflict" as const,
          message: "Cette partie reste à programmer.",
        };
      }
      if ((commonSlots.get(node.id)?.length ?? 0) === 0) {
        return {
          nodeId,
          code: "no_common_availability" as const,
          message:
            "Aucun créneau n’est commun à toutes les équipes possibles : programmation manuelle nécessaire.",
        };
      }
      if (
        node.dependencyNodeIds.some(
          (dependencyId) => !assignmentByNode.has(dependencyId),
        )
      ) {
        return {
          nodeId,
          code: "dependency_unscheduled" as const,
          message:
            "Le tour précédent n’est pas encore programmé : cette partie reste à programmer.",
        };
      }
      return {
        nodeId,
        code: "capacity_conflict" as const,
        message:
          "Les créneaux communs existent mais les contraintes de terrain, d’ordre ou de repos empêchent le placement.",
      };
    });

    return { assignments, unscheduledNodeIds, diagnostics };
  };

  for (let index = 0; index < Math.max(1, iterations); index += 1) {
    const candidate = attempt();
    if (
      !best ||
      candidate.unscheduledNodeIds.length < best.unscheduledNodeIds.length ||
      (candidate.unscheduledNodeIds.length === best.unscheduledNodeIds.length &&
        assignmentSignature(candidate.assignments) <
          assignmentSignature(best.assignments))
    ) {
      best = candidate;
    }
  }

  return (
    best ?? {
      assignments: existingAssignments,
      unscheduledNodeIds: nodes.map((node) => node.id),
      diagnostics: [],
    }
  );
};
