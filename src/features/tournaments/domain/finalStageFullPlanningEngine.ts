import type {
  PlanningSlot,
  TeamPlanningAvailability,
} from "./planningEngine.js";
import {
  isFinalStageSlotCommonForNode,
  type FinalStagePlanningAssignment,
  type FinalStagePlanningDiagnostic,
  type FinalStagePlanningNode,
  type FinalStagePlanningProposal,
  type FinalStagePlanningValidation,
} from "./finalStagePlanningEngine.js";

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

const stageOrderIsValid = ({
  node,
  slot,
  assignments,
  nodeById,
  slotById,
  minimumRestMinutes,
}: {
  node: FinalStagePlanningNode;
  slot: PlanningSlot;
  assignments: FinalStagePlanningAssignment[];
  nodeById: Map<string, FinalStagePlanningNode>;
  slotById: Map<string, PlanningSlot>;
  minimumRestMinutes: number;
}) => {
  const candidate = slotRange(slot);

  for (const assignment of assignments) {
    if (assignment.nodeId === node.id) continue;
    const otherNode = nodeById.get(assignment.nodeId);
    const otherSlot = slotById.get(assignment.slotId);
    if (!otherNode || !otherSlot || otherNode.seriesId !== node.seriesId) {
      continue;
    }
    if (otherNode.roundNumber === node.roundNumber) continue;

    const other = slotRange(otherSlot);
    if (
      otherNode.roundNumber < node.roundNumber &&
      candidate.start - other.end < minimumRestMinutes
    ) {
      return false;
    }
    if (
      otherNode.roundNumber > node.roundNumber &&
      other.start - candidate.end < minimumRestMinutes
    ) {
      return false;
    }
  }

  return true;
};

export const validateFullFinalStagePlanning = ({
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
  const seenNodes = new Set<string>();
  const seenSlots = new Set<string>();

  for (const assignment of assignments) {
    const node = nodeById.get(assignment.nodeId);
    const slot = slotById.get(assignment.slotId);
    if (
      !node ||
      !slot ||
      seenNodes.has(assignment.nodeId) ||
      seenSlots.has(assignment.slotId)
    ) {
      diagnostics.push({
        nodeId: assignment.nodeId,
        code: "invalid_assignment",
        message: "Ce créneau crée un doublon ou n’existe plus.",
      });
      continue;
    }
    seenNodes.add(assignment.nodeId);
    seenSlots.add(assignment.slotId);
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
        message: "Ce créneau n’est pas commun aux équipes concernées.",
      });
      continue;
    }

    if (
      !stageOrderIsValid({
        node,
        slot,
        assignments,
        nodeById,
        slotById,
        minimumRestMinutes,
      })
    ) {
      diagnostics.push({
        nodeId: node.id,
        code: "invalid_assignment",
        message:
          "Ce créneau place une étape avant un tour précédent ou trop près de celui-ci.",
      });
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

const signature = (assignments: FinalStagePlanningAssignment[]) =>
  [...assignments]
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId))
    .map((assignment) => `${assignment.nodeId}|${assignment.slotId}`)
    .join(";");

export const generateFullFinalStagePlanning = ({
  nodes,
  slots,
  availability,
  existingAssignments = [],
  fixedNodeIds = [],
  minimumRestMinutes = 0,
  iterations = 400,
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
    const assignedNodes = new Set(assignments.map((item) => item.nodeId));
    const usedSlots = new Set(assignments.map((item) => item.slotId));

    const editable = nodes
      .filter((node) => !fixed.has(node.id) && !assignedNodes.has(node.id))
      .sort((left, right) => {
        if (left.roundNumber !== right.roundNumber) {
          return left.roundNumber - right.roundNumber;
        }
        const difference =
          (commonSlots.get(left.id)?.length ?? 0) -
          (commonSlots.get(right.id)?.length ?? 0);
        return difference !== 0 ? difference : random() - 0.5;
      });

    for (const node of editable) {
      const candidates = (commonSlots.get(node.id) ?? [])
        .filter((slot) => !usedSlots.has(slot.id))
        .filter((slot) =>
          stageOrderIsValid({
            node,
            slot,
            assignments,
            nodeById,
            slotById,
            minimumRestMinutes,
          }),
        )
        .sort((left, right) => {
          const leftRange = slotRange(left);
          const rightRange = slotRange(right);
          return leftRange.start - rightRange.start || random() - 0.5;
        });

      const selected = candidates[0];
      if (!selected) continue;
      assignments.push({ nodeId: node.id, slotId: selected.id });
      assignedNodes.add(node.id);
      usedSlots.add(selected.id);
    }

    const unscheduledNodeIds = nodes
      .filter((node) => !assignedNodes.has(node.id))
      .map((node) => node.id);
    const diagnostics = unscheduledNodeIds.map((nodeId) => {
      const node = nodeById.get(nodeId);
      const commonCount = node ? (commonSlots.get(node.id)?.length ?? 0) : 0;
      return commonCount === 0
        ? {
            nodeId,
            code: "no_common_availability" as const,
            message:
              "Aucun créneau commun : la partie reste à programmer manuellement.",
          }
        : {
            nodeId,
            code: "capacity_conflict" as const,
            message:
              "Des créneaux communs existent mais les terrains ou l’ordre des étapes empêchent le placement automatique.",
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
        signature(candidate.assignments) < signature(best.assignments))
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
