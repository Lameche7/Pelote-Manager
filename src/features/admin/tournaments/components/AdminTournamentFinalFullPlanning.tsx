import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import {
  tournamentFinalStageAdminService,
  type TournamentFinalFullPlanningNodeRow,
  type TournamentFinalFullPlanningWorkspace,
  type TournamentFinalFullPlanningUpdate,
} from "@/features/admin/tournaments/services/tournamentFinalStageAdminService";
import {
  buildFinalStagePlanningNodes,
  finalStagePlanningNodeId,
  isFinalStageSlotCommonForNode,
  type FinalStagePlanningAssignment,
  type FinalStagePlanningNode,
} from "@/features/tournaments/domain/finalStagePlanningEngine";
import {
  finalRoundAvailableSlots,
  finalRoundDateWindow,
  generateFullFinalStagePlanning,
  validateFullFinalStagePlanning,
} from "@/features/tournaments/domain/finalStageFullPlanningEngine";
import type { PlanningSlot } from "@/features/tournaments/domain/planningEngine";
import { describeFinalStageOpponents } from "@/features/tournaments/domain/finalStageOpponentDescription";
import { AdminTournamentFinalWeeklyOverview } from "./AdminTournamentFinalWeeklyOverview";
import { AdminTournamentFinalDayLineup } from "./AdminTournamentFinalDayLineup";

const roundLabels: Record<string, string> = {
  preliminary: "Barrages",
  round_of_32: "1/16 de finale",
  round_of_16: "1/8 de finale",
  quarterfinal: "Quarts de finale",
  semifinal: "Demi-finales",
  final: "Finale",
};

const roundLabel = (round: string) =>
  roundLabels[round] ?? round.replaceAll("_", " ");

const shortDate = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

const formatDate = (value: string) =>
  shortDate.format(new Date(`${value}T12:00:00`));

const slotSortKey = (slot: PlanningSlot) =>
  `${slot.date}|${slot.startsAt}|${slot.resourceName}`;

const slotLabel = (slot: PlanningSlot) =>
  `${formatDate(slot.date)} · ${slot.startsAt.slice(0, 5)} · ${slot.resourceName}`;

const persistedSlotId = (
  row: TournamentFinalFullPlanningNodeRow,
  slots: PlanningSlot[],
) => {
  if (!row.resourceId || !row.playDate || !row.startsAt || !row.endsAt) {
    return null;
  }
  return (
    slots.find(
      (slot) =>
        slot.resourceId === row.resourceId &&
        slot.date === row.playDate &&
        slot.startsAt.slice(0, 5) === row.startsAt?.slice(0, 5) &&
        slot.endsAt.slice(0, 5) === row.endsAt?.slice(0, 5),
    )?.id ?? null
  );
};

const rowNodeId = (row: TournamentFinalFullPlanningNodeRow) =>
  finalStagePlanningNodeId(row.seriesId, row.roundNumber, row.displayOrder);

const actualMatchesForSeries = (
  workspace: TournamentFinalFullPlanningWorkspace,
  seriesId: string,
) =>
  workspace.nodes
    .filter((row) => row.seriesId === seriesId && row.actualMatchId)
    .map((row) => ({
      id: row.actualMatchId ?? "",
      round: row.round,
      roundNumber: row.roundNumber,
      displayOrder: row.displayOrder,
      teamAId: row.teamAId ?? "",
      teamALabel: row.teamALabel ?? "Équipe A",
      teamBId: row.teamBId ?? "",
      teamBLabel: row.teamBLabel ?? "Équipe B",
      resultStatus: row.resultStatus,
      published: row.published,
    }));

const buildNodes = (workspace: TournamentFinalFullPlanningWorkspace) =>
  workspace.series.flatMap((series) =>
    buildFinalStagePlanningNodes({
      seriesId: series.id,
      qualifierCount: series.qualifierCount,
      crossPools: series.crossPools,
      seeds: series.seeds,
      actualMatches: actualMatchesForSeries(workspace, series.id),
    }),
  );

const assignmentsFromWorkspace = (
  workspace: TournamentFinalFullPlanningWorkspace,
): FinalStagePlanningAssignment[] =>
  workspace.nodes.flatMap((row) => {
    const slotId = persistedSlotId(row, workspace.slots);
    return slotId ? [{ nodeId: rowNodeId(row), slotId }] : [];
  });

const assignmentMap = (assignments: FinalStagePlanningAssignment[]) =>
  new Map(
    assignments.map((assignment) => [assignment.nodeId, assignment.slotId]),
  );

export function AdminTournamentFinalFullPlanning({
  tournamentId,
  refreshKey,
  onPlanningChanged,
}: {
  tournamentId: string;
  refreshKey: number;
  onPlanningChanged?: () => Promise<void> | void;
}) {
  const [workspace, setWorkspace] =
    useState<TournamentFinalFullPlanningWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editingRound, setEditingRound] = useState<number | null>(null);
  const [quickNodeId, setQuickNodeId] = useState("");
  const [quickSlotId, setQuickSlotId] = useState("");
  const [quickFocusDate, setQuickFocusDate] = useState<string | null>(null);
  const [quickQueueFilter, setQuickQueueFilter] = useState("all");
  const [finalDayStart, setFinalDayStart] = useState("");
  const [finalDayEnd, setFinalDayEnd] = useState("");
  const [exclude2130, setExclude2130] = useState(false);
  const [exceptionNodeId, setExceptionNodeId] = useState<string | null>(null);
  const [exceptionDate, setExceptionDate] = useState("");
  const [exceptionStart, setExceptionStart] = useState("");
  const [exceptionEnd, setExceptionEnd] = useState("");
  const [exceptionResourceId, setExceptionResourceId] = useState("");
  const [manualAssignments, setManualAssignments] = useState<
    FinalStagePlanningAssignment[]
  >([]);

  const load = useCallback(async () => {
    const loaded =
      await tournamentFinalStageAdminService.getFullPlanning(tournamentId);
    setWorkspace(loaded);
    setManualAssignments(assignmentsFromWorkspace(loaded));
  }, [tournamentId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    tournamentFinalStageAdminService
      .getFullPlanning(tournamentId)
      .then((loaded) => {
        if (!active) return;
        setWorkspace(loaded);
        setManualAssignments(assignmentsFromWorkspace(loaded));
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Impossible de charger le planning complet des phases finales.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tournamentId, refreshKey]);

  useEffect(() => {
    if (workspace && window.location.hash === "#planning-phases-finales") {
      document
        .getElementById("planning-phases-finales")
        ?.scrollIntoView({ behavior: "smooth" });
    }
  }, [workspace]);

  const nodes = useMemo(
    () => (workspace ? buildNodes(workspace) : []),
    [workspace],
  );
  const rowById = useMemo(
    () =>
      new Map(
        (workspace?.nodes ?? []).map((row) => [rowNodeId(row), row] as const),
      ),
    [workspace?.nodes],
  );
  // Only a created fixture with two known teams belongs in the live scheduler.
  const realMatchNodes = useMemo(
    () =>
      nodes.filter((node) => {
        const row = rowById.get(node.id);
        return Boolean(row?.actualMatchId && row.teamAId && row.teamBId);
      }),
    [nodes, rowById],
  );
  const slotById = useMemo(
    () => new Map((workspace?.slots ?? []).map((slot) => [slot.id, slot])),
    [workspace?.slots],
  );
  const sortedSlots = useMemo(
    () =>
      (workspace?.slots ?? [])
        .filter((slot) => !workspace?.exceptionalSlotIds.includes(slot.id))
        .sort((left, right) =>
          slotSortKey(left).localeCompare(slotSortKey(right)),
        ),
    [workspace?.slots, workspace?.exceptionalSlotIds],
  );

  const stages = useMemo(() => {
    const grouped = new Map<
      number,
      { roundNumber: number; round: string; nodes: FinalStagePlanningNode[] }
    >();
    for (const node of nodes) {
      const existing = grouped.get(node.roundNumber);
      if (existing) existing.nodes.push(node);
      else {
        grouped.set(node.roundNumber, {
          roundNumber: node.roundNumber,
          round: node.round,
          nodes: [node],
        });
      }
    }
    return [...grouped.values()].sort(
      (left, right) => left.roundNumber - right.roundNumber,
    );
  }, [nodes]);

  const persistedAssignments = useMemo(
    () => (workspace ? assignmentsFromWorkspace(workspace) : []),
    [workspace],
  );
  const persistedByNode = useMemo(
    () => assignmentMap(persistedAssignments),
    [persistedAssignments],
  );
  const manualByNode = useMemo(
    () => assignmentMap(manualAssignments),
    [manualAssignments],
  );
  const unprogrammedDiagnostics = useMemo(() => {
    if (!workspace) return new Map<string, string>();
    const used = new Set(persistedAssignments.map((item) => item.slotId));
    const result = new Map<string, string>();
    for (const node of realMatchNodes) {
      if (persistedByNode.has(node.id)) continue;
      const availability = finalRoundAvailableSlots({
        node,
        nodes,
        slots: workspace.slots,
        availability: workspace.availability,
        finalsStartsOn: workspace.tournament.finalsStartsOn ?? undefined,
        finalsEndsOn: workspace.tournament.finalsEndsOn ?? undefined,
      });
      const normalWindow =
        workspace.tournament.finalsStartsOn && workspace.tournament.finalsEndsOn
          ? finalRoundDateWindow({
              node,
              nodes,
              finalsStartsOn: workspace.tournament.finalsStartsOn,
              finalsEndsOn: workspace.tournament.finalsEndsOn,
            })
          : null;
      const available = availability.candidates.filter(
        (slot) => !used.has(slot.id),
      );
      const first = available[0];
      if (first) {
        result.set(
          node.id,
          availability.exception
            ? `Dérogation possible : ${slotLabel(first)}. Date normale limite : ${normalWindow ? formatDate(normalWindow.latest) : "—"}. À vérifier avec les tours suivants.`
            : `Créneau commun : ${slotLabel(first)}. Le placement reste contraint par les autres rencontres et les tours suivants.`,
        );
      } else if (availability.candidates.length > 0) {
        result.set(
          node.id,
          `Disponibilités communes trouvées, mais les créneaux sont déjà affectés. Exemple : ${slotLabel(availability.candidates[0])}. Réorganisation nécessaire.`,
        );
      } else {
        result.set(
          node.id,
          `Aucune disponibilité commune compatible avec ce tour${normalWindow ? ` (période normale jusqu’au ${formatDate(normalWindow.latest)})` : ""}. Relancer les équipes ou prévoir un ajustement manuel.`,
        );
      }
    }
    return result;
  }, [nodes, realMatchNodes, persistedAssignments, persistedByNode, workspace]);

  const officialFinalDate = workspace?.tournament.finalsEndsOn;
  const finalDaySlotCount = officialFinalDate
    ? (workspace?.slots ?? []).filter((slot) => slot.date === officialFinalDate)
        .length
    : 0;
  const quickQueue = realMatchNodes.filter((node) => {
    const row = rowById.get(node.id);
    return (
      row &&
      !persistedByNode.has(node.id) &&
      !row.published &&
      row.resultStatus !== "validated"
    );
  });
  // Queue only: the automatic finals progression remains the primary scheduler.
  // Prioritize resolved matches for the organizer's manual intervention.
  const hasResolvedOpponents = (node: FinalStagePlanningNode) => {
    const row = rowById.get(node.id);
    return Boolean(row?.teamAId && row?.teamBId);
  };
  const queuePriority = (node: FinalStagePlanningNode) => {
    if (!hasResolvedOpponents(node)) return 2;
    return unprogrammedDiagnostics.get(node.id)?.startsWith("Créneau commun")
      ? 0
      : 1;
  };
  const visibleQuickQueue = quickQueue
    .filter(
      (node) =>
        quickQueueFilter === "all" || node.seriesId === quickQueueFilter,
    )
    .sort(
      (left, right) =>
        queuePriority(left) - queuePriority(right) ||
        left.seriesId.localeCompare(right.seriesId) ||
        left.roundNumber - right.roundNumber ||
        left.displayOrder - right.displayOrder,
    );
  const resolvedQueueCount = quickQueue.filter(hasResolvedOpponents).length;
  const manualUnpublishedMatches = (workspace?.nodes ?? []).filter(
    (row) =>
      row.source === "manual" &&
      Boolean(
        row.actualMatchId &&
        row.teamAId &&
        row.teamBId &&
        row.playDate &&
        row.startsAt,
      ) &&
      !row.published &&
      row.resultStatus !== "validated",
  );
  const quickNode = nodes.find((node) => node.id === quickNodeId);
  const quickSlot = workspace?.slots.find((slot) => slot.id === quickSlotId);
  const quickRow = quickNode ? rowById.get(quickNode.id) : null;
  const quickAssignable = Boolean(
    quickNode &&
    quickRow &&
    Boolean(quickRow.teamAId && quickRow.teamBId) &&
    !quickRow.published &&
    quickRow.resultStatus !== "validated",
  );
  const quickCommon =
    quickNode && quickSlot && workspace
      ? isFinalStageSlotCommonForNode({
          node: quickNode,
          slot: quickSlot,
          availability: workspace.availability,
        })
      : false;
  const quickSlotKey = quickSlot
    ? `${quickSlot.resourceId}|${quickSlot.date}|${quickSlot.startsAt.slice(0, 5)}|${quickSlot.endsAt.slice(0, 5)}`
    : "";
  const quickOccupied = Boolean(
    workspace &&
    quickSlot &&
    (workspace.weeklyOccupiedSlotIds.some(
      (value) =>
        value
          .split("|")
          .map((part, i) => (i >= 2 ? part.slice(0, 5) : part))
          .join("|") === quickSlotKey,
    ) ||
      workspace.nodes.some(
        (row) =>
          rowNodeId(row) !== quickNodeId &&
          row.resourceId === quickSlot.resourceId &&
          row.playDate === quickSlot.date &&
          row.startsAt?.slice(0, 5) === quickSlot.startsAt.slice(0, 5) &&
          row.endsAt?.slice(0, 5) === quickSlot.endsAt.slice(0, 5),
      )),
  );
  const quickAssignments =
    quickNode && quickSlot
      ? [
          ...persistedAssignments.filter(
            (assignment) => assignment.nodeId !== quickNode.id,
          ),
          { nodeId: quickNode.id, slotId: quickSlot.id },
        ]
      : persistedAssignments;
  const quickNormalWindow =
    workspace?.tournament.finalsStartsOn &&
    workspace.tournament.finalsEndsOn &&
    quickNode
      ? finalRoundDateWindow({
          node: quickNode,
          nodes,
          finalsStartsOn: workspace.tournament.finalsStartsOn,
          finalsEndsOn: workspace.tournament.finalsEndsOn,
        })
      : null;
  const quickOutsideRoundWindow = Boolean(
    quickNormalWindow &&
    quickSlot &&
    (quickSlot.date < quickNormalWindow.earliest ||
      quickSlot.date > quickNormalWindow.latest),
  );
  const quickValidation =
    workspace && quickNode && quickSlot
      ? validateFullFinalStagePlanning({
          nodes,
          slots: workspace.slots,
          availability: workspace.availability,
          assignments: quickAssignments,
          minimumRestMinutes: workspace.tournament.minimumRestMinutes,
          respectAvailability: false,
          allowManualRoundDateOverride: true,
          finalsStartsOn: workspace.tournament.finalsStartsOn ?? undefined,
          finalsEndsOn: workspace.tournament.finalsEndsOn ?? undefined,
        })
      : null;
  const quickError = quickOccupied
    ? "Ce créneau est déjà occupé par une réservation ou une autre rencontre."
    : quickValidation && !quickValidation.valid
      ? (quickValidation.diagnostics.find(
          (diagnostic) => diagnostic.nodeId === quickNodeId,
        )?.message ?? quickValidation.diagnostics[0]?.message)
      : null;
  const quickRecommendations = useMemo(() => {
    if (!workspace || !quickNode || !quickAssignable) return [];
    const occupied = new Set(
      workspace.weeklyOccupiedSlotIds.map((value) =>
        value
          .split("|")
          .map((part, index) => (index >= 2 ? part.slice(0, 5) : part))
          .join("|"),
      ),
    );
    const assigned = new Set(
      workspace.nodes
        .filter(
          (row) =>
            rowNodeId(row) !== quickNode.id &&
            row.resourceId &&
            row.playDate &&
            row.startsAt &&
            row.endsAt,
        )
        .map(
          (row) =>
            `${row.resourceId}|${row.playDate}|${row.startsAt?.slice(0, 5)}|${row.endsAt?.slice(0, 5)}`,
        ),
    );
    const suggestions = [] as Array<{
      slot: PlanningSlot;
      common: boolean;
      normal: boolean;
    }>;
    const normalWindow =
      workspace.tournament.finalsStartsOn && workspace.tournament.finalsEndsOn
        ? finalRoundDateWindow({
            node: quickNode,
            nodes,
            finalsStartsOn: workspace.tournament.finalsStartsOn,
            finalsEndsOn: workspace.tournament.finalsEndsOn,
          })
        : null;
    for (const slot of [...workspace.slots].sort((a, b) =>
      slotSortKey(a).localeCompare(slotSortKey(b)),
    )) {
      const key = `${slot.resourceId}|${slot.date}|${slot.startsAt.slice(0, 5)}|${slot.endsAt.slice(0, 5)}`;
      if (occupied.has(key) || assigned.has(key)) continue;
      const assignments = [
        ...persistedAssignments.filter((item) => item.nodeId !== quickNode.id),
        { nodeId: quickNode.id, slotId: slot.id },
      ];
      const validation = validateFullFinalStagePlanning({
        nodes,
        slots: workspace.slots,
        availability: workspace.availability,
        assignments,
        minimumRestMinutes: workspace.tournament.minimumRestMinutes,
        respectAvailability: false,
        finalsStartsOn: workspace.tournament.finalsStartsOn ?? undefined,
        finalsEndsOn: workspace.tournament.finalsEndsOn ?? undefined,
      });
      if (!validation.valid) continue;
      suggestions.push({
        slot,
        common: isFinalStageSlotCommonForNode({
          node: quickNode,
          slot,
          availability: workspace.availability,
        }),
        normal:
          !normalWindow ||
          (slot.date >= normalWindow.earliest &&
            slot.date <= normalWindow.latest),
      });
    }
    // Explicit preference order: jointly available within the normal round window.
    return suggestions
      .sort(
        (a, b) =>
          Number(b.common && b.normal) - Number(a.common && a.normal) ||
          Number(b.common) - Number(a.common) ||
          Number(b.normal) - Number(a.normal) ||
          slotSortKey(a.slot).localeCompare(slotSortKey(b.slot)),
      )
      .slice(0, 6);
  }, [workspace, quickNode, quickAssignable, nodes, persistedAssignments]);
  const plannedCount = realMatchNodes.filter((node) =>
    persistedByNode.has(node.id),
  ).length;
  const unplannedCount = realMatchNodes.filter((node) => {
    const row = rowById.get(node.id);
    return (
      !persistedByNode.has(node.id) &&
      !row?.published &&
      row?.resultStatus !== "validated"
    );
  }).length;
  const theoreticalPositionsCount = nodes.length - realMatchNodes.length;

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setMessage(await action());
      await load();
      await onPlanningChanged?.();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "L’action n’a pas pu être réalisée.",
      );
    } finally {
      setBusy(false);
    }
  };

  const saveQuickAssignment = () =>
    run(async () => {
      if (
        !workspace ||
        !quickNode ||
        !quickSlot ||
        !quickAssignable ||
        quickOccupied ||
        !quickValidation?.valid
      ) {
        throw new Error(
          "Sélectionnez une rencontre modifiable et un créneau compatible.",
        );
      }
      if (
        quickOutsideRoundWindow &&
        !window.confirm(
          "Ce créneau est en dehors de la période prévue pour ce tour. Vous pouvez le préprogrammer exceptionnellement, sous réserve de respecter le calendrier des tours suivants. Confirmer cette dérogation administrateur ?",
        )
      )
        return "Programmation annulée.";
      // A slot without common availability is an explicit organizer override.
      if (
        !quickCommon &&
        !window.confirm(
          "Ce créneau n'est pas déclaré disponible par toutes les équipes concernées. Confirmer la préprogrammation provisoire ? Elle ne sera publiée que si les deux équipes ont confirmé ce créneau.",
        )
      )
        return "Programmation annulée.";
      await tournamentFinalStageAdminService.saveFullPlanning(
        tournamentId,
        [
          {
            seriesId: quickNode.seriesId,
            roundNumber: quickNode.roundNumber,
            displayOrder: quickNode.displayOrder,
            slotId: quickSlot.id,
            source: "manual",
          },
        ],
        workspace.slots,
      );
      const published =
        await tournamentFinalStageAdminService.publishReadyManualFinal(
          tournamentId,
          quickNode.seriesId,
          quickNode.roundNumber,
          quickNode.displayOrder,
        );
      setQuickNodeId("");
      setQuickSlotId("");
      setQuickFocusDate(null);
      return published
        ? "Rencontre publiée dans le calendrier : les notifications habituelles ont été déclenchées."
        : "Créneau préprogrammé, sans publication : disponibilités communes ou conditions de publication non réunies.";
    });

  const addFinalDaySlot = () =>
    run(async () => {
      if (!workspace || !finalDayStart || !finalDayEnd) return "";
      await tournamentFinalStageAdminService.addFinalDaySlot(
        tournamentId,
        finalDayStart,
        finalDayEnd,
      );
      setFinalDayStart("");
      setFinalDayEnd("");
      return "Créneau des finales ajouté. Relancez le calcul pour le proposer dans le planning.";
    });

  const autoPlan = () =>
    run(async () => {
      if (!workspace) return "";
      // Recalculate actual complete fixtures only. Never place future rounds
      // whose qualified teams have not both been identified.
      const realNodeIds = new Set(realMatchNodes.map((node) => node.id));
      const existing = assignmentsFromWorkspace(workspace).filter(
        (assignment) => {
          const row = rowById.get(assignment.nodeId);
          return Boolean(
            realNodeIds.has(assignment.nodeId) &&
            row &&
            (row.published ||
              row.resultStatus === "validated" ||
              row.source !== "generated"),
          );
        },
      );
      const fixedNodeIds = workspace.nodes
        .filter(
          (row) =>
            realNodeIds.has(rowNodeId(row)) &&
            (row.published ||
              row.resultStatus === "validated" ||
              row.source === "manual"),
        )
        .map(rowNodeId);
      const normalizedOccupied = new Set(
        workspace.weeklyOccupiedSlotIds.map((value) =>
          value
            .split("|")
            .map((part, index) => (index >= 2 ? part.slice(0, 5) : part))
            .join("|"),
        ),
      );
      const occupiedSlotIds = workspace.slots
        .filter((slot) =>
          normalizedOccupied.has(
            `${slot.resourceId}|${slot.date}|${slot.startsAt.slice(0, 5)}|${slot.endsAt.slice(0, 5)}`,
          ),
        )
        .map((slot) => slot.id);
      // An official final-day reservation may have no finalist yet.
      const reservedFinalSlots = persistedAssignments
        .filter((assignment) => !realNodeIds.has(assignment.nodeId))
        .map((assignment) => assignment.slotId);
      const proposal = generateFullFinalStagePlanning({
        nodes: realMatchNodes,
        slots: workspace.slots,
        excludeStartsAt2130: exclude2130,
        nonCandidateSlotIds: [
          ...workspace.exceptionalSlotIds,
          ...occupiedSlotIds,
          ...reservedFinalSlots,
        ],
        availability: workspace.availability,
        existingAssignments: existing,
        fixedNodeIds,
        minimumRestMinutes: workspace.tournament.minimumRestMinutes,
        iterations: 80,
        finalsStartsOn: workspace.tournament.finalsStartsOn ?? undefined,
        finalsEndsOn: workspace.tournament.finalsEndsOn ?? undefined,
      });
      const proposedByNode = assignmentMap(proposal.assignments);
      const updates: TournamentFinalFullPlanningUpdate[] = workspace.nodes
        .filter(
          (row) =>
            realNodeIds.has(rowNodeId(row)) &&
            row.resultStatus !== "validated" &&
            !row.published &&
            !(
              row.resourceId &&
              persistedByNode.get(rowNodeId(row)) &&
              workspace.exceptionalSlotIds.includes(
                persistedByNode.get(rowNodeId(row)) ?? "",
              )
            ),
        )
        .map((row) => {
          const nodeId = rowNodeId(row);
          const preservedManual = row.source === "manual";
          return {
            seriesId: row.seriesId,
            roundNumber: row.roundNumber,
            displayOrder: row.displayOrder,
            slotId: proposedByNode.get(nodeId) ?? null,
            source: proposedByNode.has(nodeId)
              ? preservedManual
                ? "manual"
                : "generated"
              : null,
          };
        });
      const count = await tournamentFinalStageAdminService.saveFullPlanning(
        tournamentId,
        updates,
        workspace.slots,
      );
      const missing = proposal.unscheduledNodeIds.length;
      const mode = exclude2130 ? " (départs à 21h30 exclus du calcul)" : "";
      return missing > 0
        ? `Planning complet enregistré${mode} : ${count} partie(s) placée(s), ${missing} partie(s) restent « À programmer » manuellement.`
        : `Planning complet enregistré${mode} : les ${count} parties de toutes les séries sont placées.`;
    });

  const editExceptionalSlot = (
    nodeId: string,
    row: TournamentFinalFullPlanningNodeRow | undefined,
  ) => {
    if (!workspace) return;
    setExceptionNodeId(nodeId);
    setExceptionDate(row?.playDate ?? "");
    setExceptionStart(row?.startsAt?.slice(0, 5) ?? "16:30");
    setExceptionEnd(row?.endsAt?.slice(0, 5) ?? "17:30");
    setExceptionResourceId(row?.resourceId ?? workspace.resources[0]?.id ?? "");
  };

  const saveExceptionalSlot = (node: FinalStagePlanningNode) =>
    run(async () => {
      if (!workspace || !exceptionResourceId || !exceptionDate) {
        throw new Error("Indique une date, un horaire et un terrain.");
      }
      if (exceptionEnd <= exceptionStart) {
        throw new Error(
          "L'heure de fin doit être postérieure à l'heure de début.",
        );
      }
      if (
        (workspace.tournament.finalsStartsOn &&
          exceptionDate < workspace.tournament.finalsStartsOn) ||
        (workspace.tournament.finalsEndsOn &&
          exceptionDate > workspace.tournament.finalsEndsOn)
      ) {
        throw new Error(
          "La date doit appartenir à la période des phases finales.",
        );
      }
      await tournamentFinalStageAdminService.setExceptionalManualSlot(
        tournamentId,
        {
          seriesId: node.seriesId,
          roundNumber: node.roundNumber,
          displayOrder: node.displayOrder,
          resourceId: exceptionResourceId,
          playDate: exceptionDate,
          startsAt: exceptionStart,
          endsAt: exceptionEnd,
        },
      );
      setExceptionNodeId(null);
      setEditingRound(null);
      return "Horaire exceptionnel enregistré. Les rencontres déjà publiées restent inchangées.";
    });

  const openManualRound = (roundNumber: number) => {
    if (!workspace) return;
    setManualAssignments(assignmentsFromWorkspace(workspace));
    setEditingRound(roundNumber);
    setExceptionNodeId(null);
    setError("");
    setMessage(
      "Tu peux choisir un créneau prévu ou saisir une date et une heure exceptionnelles (samedi, avant 17h30, etc.). Les conflits de terrain et l’ordre des tours restent contrôlés.",
    );
  };

  const changeManualSlot = (nodeId: string, slotId: string) => {
    if (!workspace) return;
    const next = [
      ...manualAssignments.filter((item) => item.nodeId !== nodeId),
      ...(slotId ? [{ nodeId, slotId }] : []),
    ];
    const validation = validateFullFinalStagePlanning({
      nodes,
      slots: workspace.slots,
      availability: workspace.availability,
      assignments: next,
      minimumRestMinutes: workspace.tournament.minimumRestMinutes,
      respectAvailability: false,
      finalsStartsOn: workspace.tournament.finalsStartsOn ?? undefined,
      finalsEndsOn: workspace.tournament.finalsEndsOn ?? undefined,
    });
    if (!validation.valid) {
      setError(
        validation.diagnostics.find(
          (diagnostic) => diagnostic.nodeId === nodeId,
        )?.message ??
          validation.diagnostics[0]?.message ??
          "Ce déplacement crée un conflit.",
      );
      return;
    }
    setManualAssignments(next);
    setError("");
  };

  const saveManualRound = () =>
    run(async () => {
      if (!workspace || editingRound === null) return "";
      const editableRows = workspace.nodes.filter(
        (row) =>
          row.roundNumber === editingRound &&
          Boolean(row.actualMatchId && row.teamAId && row.teamBId) &&
          row.resultStatus !== "validated" &&
          !row.published &&
          !(
            workspace.exceptionalSlotIds.includes(
              persistedByNode.get(rowNodeId(row)) ?? "",
            ) &&
            manualByNode.get(rowNodeId(row)) ===
              persistedByNode.get(rowNodeId(row))
          ),
      );
      const updates: TournamentFinalFullPlanningUpdate[] = editableRows.map(
        (row) => ({
          seriesId: row.seriesId,
          roundNumber: row.roundNumber,
          displayOrder: row.displayOrder,
          slotId: manualByNode.get(rowNodeId(row)) ?? null,
          source: manualByNode.has(rowNodeId(row)) ? "manual" : null,
        }),
      );
      const count = await tournamentFinalStageAdminService.saveFullPlanning(
        tournamentId,
        updates,
        workspace.slots,
      );
      setEditingRound(null);
      return `${roundLabel(editableRows[0]?.round ?? "tour")} : ${count} partie(s) programmée(s). Les autres restent « À programmer ».`;
    });

  if (loading) {
    return (
      <section className="final-stage-full-planning">
        <p role="status">Préparation du planning complet des phases finales…</p>
      </section>
    );
  }

  if (!workspace) return null;

  return (
    <section className="final-stage-full-planning" id="planning-phases-finales">
      <header className="final-stage-full-planning__header">
        <div>
          <p>Organisation globale</p>
          <h3>Planning complet des phases finales</h3>
        </div>
        <div className="final-stage-full-planning__summary">
          <strong>
            {plannedCount}/{realMatchNodes.length}
          </strong>
          <span>
            {unplannedCount > 0
              ? `${unplannedCount} rencontre(s) à programmer`
              : "Parties connues suivies"}
          </span>
        </div>
      </header>

      <p className="final-stage-full-planning__hint">
        Ce planning dynamique affiche les rencontres réellement constituées, les
        créneaux libres et les horaires de finales fixés par le club. Les tours
        encore théoriques restent dans le tableau sportif, sans immobiliser de
        créneaux. Après validation d’un résultat, Pilotoki tente automatiquement
        de placer le prochain match avec les disponibilités communes. Les
        parties impossibles restent « À programmer ». Un recalcul ne déplace ni
        les parties publiées ni les horaires confirmés.
      </p>

      {error && (
        <p
          className="qualification-alert qualification-alert--error"
          role="alert"
        >
          {error}
        </p>
      )}
      {message && (
        <p className="qualification-alert" role="status">
          {message}
        </p>
      )}

      <section
        className="final-stage-full-planning__quick"
        aria-label="Programmation rapide"
      >
        <h4>Rencontres à programmer ({quickQueue.length})</h4>
        <p>
          Choisissez une partie en attente, puis un créneau libre dans le
          calendrier. Les rencontres déjà placées restent modifiables dans le
          sélecteur.
        </p>
        <label>
          Afficher les rencontres de
          <select
            value={quickQueueFilter}
            onChange={(event) => setQuickQueueFilter(event.target.value)}
          >
            <option value="all">Toutes les séries</option>
            {workspace.series.map((series) => (
              <option key={series.id} value={series.id}>
                {series.name}
              </option>
            ))}
          </select>
        </label>
        <p className="final-stage-queue__summary">
          <strong>
            {resolvedQueueCount} rencontre(s) avec deux adversaires connus
          </strong>
          <span>
            {" "}
            · {theoreticalPositionsCount} position(s) théorique(s) sans
            réservation
          </span>
        </p>
        {visibleQuickQueue.length === 0 ? (
          <p role="status">Aucune rencontre en attente pour ce filtre.</p>
        ) : (
          <div className="final-stage-queue__grid">
            {visibleQuickQueue.map((node) => {
              const series = workspace.series.find(
                (item) => item.id === node.seriesId,
              );
              const row = rowById.get(node.id);
              const known = hasResolvedOpponents(node);
              const common =
                unprogrammedDiagnostics
                  .get(node.id)
                  ?.startsWith("Créneau commun") ?? false;
              const status = !known
                ? "waiting"
                : common
                  ? "ready"
                  : "constrained";
              const statusLabel = !known
                ? "Adversaires en attente"
                : common
                  ? "Deux équipes connues"
                  : "Placement à examiner";
              const matchLabel =
                known && row?.teamALabel && row.teamBLabel
                  ? `${row.teamALabel} — ${row.teamBLabel}`
                  : describeFinalStageOpponents({
                      node,
                      nodes,
                      seeds: series?.seeds ?? [],
                      crossPools: series?.crossPools ?? false,
                    });
              return (
                <button
                  key={node.id}
                  type="button"
                  className={`final-stage-queue__card final-stage-queue__card--${status}`}
                  style={
                    {
                      "--series-color": series?.color ?? "#64748b",
                    } as CSSProperties
                  }
                  disabled={busy || !known}
                  aria-pressed={quickNodeId === node.id}
                  title={
                    unprogrammedDiagnostics.get(node.id) ??
                    (known
                      ? "Choisir une rencontre"
                      : "En attente de la connaissance des deux équipes")
                  }
                  onClick={() => {
                    setQuickNodeId(node.id);
                    setQuickSlotId("");
                    setQuickFocusDate(null);
                    setError("");
                  }}
                >
                  <span className="final-stage-queue__heading">
                    <strong>
                      {series?.name ?? "Série"} · {roundLabel(node.round)}
                    </strong>
                    <span
                      className={`final-stage-queue__badge final-stage-queue__badge--${status}`}
                    >
                      {statusLabel}
                    </span>
                  </span>
                  <span className="final-stage-queue__opponents">
                    {matchLabel}
                  </span>
                  <span className="final-stage-queue__footnote">
                    {known
                      ? "À programmer manuellement · Voir les créneaux conseillés"
                      : "Le moteur attend les deux adversaires"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <label>
          Partie à programmer
          <select
            value={quickNodeId}
            disabled={busy}
            onChange={(event) => {
              setQuickNodeId(event.target.value);
              setQuickSlotId("");
              setQuickFocusDate(null);
              setError("");
            }}
          >
            <option value="">Choisir une rencontre</option>
            {nodes
              .filter((node) => {
                const row = rowById.get(node.id);
                return (
                  row &&
                  row.teamAId &&
                  row.teamBId &&
                  !row.published &&
                  row.resultStatus !== "validated"
                );
              })
              .map((node) => {
                const row = rowById.get(node.id);
                const series = workspace.series.find(
                  (item) => item.id === node.seriesId,
                );
                return (
                  <option value={node.id} key={node.id}>
                    {series?.name ?? "Série"} · {roundLabel(node.round)} ·{" "}
                    {row?.teamALabel && row?.teamBLabel
                      ? `${row.teamALabel} — ${row.teamBLabel}`
                      : describeFinalStageOpponents({
                          node,
                          nodes,
                          seeds: series?.seeds ?? [],
                          crossPools: series?.crossPools ?? false,
                        })}
                    {row?.playDate ? " · Déjà prépositionnée" : ""}
                  </option>
                );
              })}
          </select>
        </label>
        {quickNode && (
          <div className="final-stage-full-planning__recommendations">
            <h5>Créneaux conseillés</h5>
            {quickRecommendations.length === 0 ? (
              <p role="status">
                Aucun créneau configuré sans conflit. Utilisez la programmation
                avancée ou ajustez les disponibilités.
              </p>
            ) : (
              <div className="final-stage-full-planning__series-grid">
                {quickRecommendations.map(({ slot, common, normal }) => (
                  <button
                    key={slot.id}
                    type="button"
                    disabled={busy}
                    aria-pressed={quickSlotId === slot.id}
                    onClick={() => {
                      setQuickSlotId(slot.id);
                      setQuickFocusDate(slot.date);
                      setError("");
                    }}
                  >
                    {slotLabel(slot)} ·{" "}
                    {common && normal
                      ? "✓ Disponibilités communes"
                      : common
                        ? "⚠ Dérogation de période"
                        : "⚠ Disponibilités à confirmer"}
                  </button>
                ))}
              </div>
            )}
            <small>
              Propositions non réservées : leur compatibilité est revérifiée
              lors de l'enregistrement.
            </small>
          </div>
        )}
        {quickSlot && (
          <p role="status">Créneau retenu : {slotLabel(quickSlot)}</p>
        )}
        {quickOutsideRoundWindow && !quickError && (
          <p role="status">
            ⚠ Ce créneau dépasse la période habituelle de ce tour. Vous pouvez
            confirmer une dérogation de programmation manuelle.
          </p>
        )}
        {quickNode && quickSlot && (
          <p role="status">
            {quickError
              ? `⛔ ${quickError}`
              : quickCommon
                ? "✓ Créneau compatible avec les disponibilités déclarées et l'ordre des tours."
                : "⚠ Disponibilités non communes ou encore inconnues : validation exceptionnelle nécessaire."}
          </p>
        )}
        <button
          type="button"
          disabled={
            busy ||
            !quickAssignable ||
            !quickSlot ||
            quickOccupied ||
            !quickValidation?.valid
          }
          onClick={() => void saveQuickAssignment()}
        >
          {busy ? "Enregistrement…" : "Préprogrammer la rencontre ici"}
        </button>
      </section>

      {manualUnpublishedMatches.length > 0 && (
        <section className="final-stage-full-planning__recommendations">
          <h4>Rencontres manuelles à publier</h4>
          <p>
            Les rencontres ci-dessous sont préprogrammées mais non publiées.
            Vous pouvez décider de les officialiser et notifier les joueurs,
            même sans disponibilités communes déclarées.
          </p>
          <div className="final-stage-full-planning__series-grid">
            {manualUnpublishedMatches.map((row) => (
              <div key={row.actualMatchId}>
                <strong>
                  {row.teamALabel ?? "Équipe A"} —{" "}
                  {row.teamBLabel ?? "Équipe B"}
                </strong>
                <p>
                  {row.playDate ? formatDate(row.playDate) : ""} ·{" "}
                  {row.startsAt?.slice(0, 5)}
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (
                        !window.confirm(
                          "Publier officiellement cette rencontre et notifier les joueurs malgré les disponibilités non communes ? Cette décision confirme l'horaire retenu par l'organisation.",
                        )
                      )
                        return "Publication annulée.";
                      const result =
                        await tournamentFinalStageAdminService.forcePublishManualFinal(
                          tournamentId,
                          row.seriesId,
                          row.roundNumber,
                          row.displayOrder,
                        );
                      return result.published
                        ? `Rencontre publiée. ${result.recipientCount} destinataire(s) de notification enregistré(s). Vérifiez la livraison push séparément.`
                        : "Publication non confirmée.";
                    })
                  }
                >
                  Publier et notifier les joueurs
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <AdminTournamentFinalWeeklyOverview
        workspace={workspace}
        selectedSlotId={quickSlotId}
        focusDate={quickFocusDate}
        disabled={busy}
        onSelectFreeSlot={(slot) => {
          setQuickSlotId(slot.id);
          setError("");
        }}
      />

      {officialFinalDate && (
        <section className="final-stage-full-planning__final-day">
          {finalDaySlotCount === 0 && (
            <p
              className="qualification-alert qualification-alert--error"
              role="status"
            >
              Aucun créneau n'est encore défini le{" "}
              {formatDate(officialFinalDate)}
              pour les finales. Indiquez leurs horaires ci-dessous avant le
              prochain calcul.
            </p>
          )}
          <strong>Journée des finales · {formatDate(officialFinalDate)}</strong>
          <AdminTournamentFinalDayLineup
            tournamentId={tournamentId}
            workspace={workspace}
            onChanged={async () => {
              await load();
              await onPlanningChanged?.();
            }}
          />
          <p>
            {finalDaySlotCount} créneau(x) disponible(s) à cette date. Les
            horaires doivent être confirmés par l'organisation.
          </p>
          <div className="final-stage-full-planning__actions">
            <label>
              Début
              <input
                type="time"
                value={finalDayStart}
                onChange={(event) => setFinalDayStart(event.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              Fin
              <input
                type="time"
                value={finalDayEnd}
                onChange={(event) => setFinalDayEnd(event.target.value)}
                disabled={busy}
              />
            </label>
            <button
              type="button"
              disabled={
                busy ||
                !finalDayStart ||
                !finalDayEnd ||
                finalDayEnd <= finalDayStart
              }
              onClick={() => void addFinalDaySlot()}
            >
              Ajouter un créneau des finales
            </button>
          </div>
        </section>
      )}

      <div className="final-stage-full-planning__actions">
        <label className="final-stage-full-planning__auto-option">
          <input
            type="checkbox"
            checked={exclude2130}
            onChange={(event) => setExclude2130(event.target.checked)}
            disabled={busy}
          />
          Exclure les créneaux de 21h30 du calcul automatique
        </label>
        <button type="button" disabled={busy} onClick={() => void autoPlan()}>
          {busy ? "Calcul…" : "Recalculer les rencontres connues"}
        </button>
      </div>
      <p className="final-stage-full-planning__hint">
        {exclude2130
          ? "Le prochain calcul ne proposera aucune nouvelle partie à 21h30. Les créneaux déjà fixés manuellement ou publiés à cette heure seront conservés."
          : "Les créneaux de 21h30 restent autorisés pour le prochain calcul. Cette option ne concerne pas les modifications manuelles."}
      </p>

      <details className="final-stage-full-planning__advanced">
        <summary>
          Programmation avancée par tour (modifier les rencontres
          individuellement)
        </summary>
        <div className="final-stage-full-planning__stages">
          {stages.map((stage) => {
            const editableNodes = stage.nodes.filter((node) => {
              const row = rowById.get(node.id);
              return (
                Boolean(row?.actualMatchId && row.teamAId && row.teamBId) &&
                row?.resultStatus !== "validated" &&
                !row?.published
              );
            });
            const isEditing = editingRound === stage.roundNumber;
            return (
              <section
                key={stage.roundNumber}
                className="final-stage-full-planning__stage"
              >
                <header>
                  <div>
                    <p>Tour de compétition</p>
                    <h4>{roundLabel(stage.round)}</h4>
                  </div>
                  {editableNodes.length > 0 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        isEditing
                          ? setEditingRound(null)
                          : openManualRound(stage.roundNumber)
                      }
                    >
                      {isEditing ? "Fermer" : "Modifier manuellement"}
                    </button>
                  )}
                </header>

                <div className="final-stage-full-planning__series-grid">
                  {workspace.series.map((series) => {
                    const seriesNodes = stage.nodes.filter(
                      (node) => node.seriesId === series.id,
                    );
                    if (seriesNodes.length === 0) return null;
                    return (
                      <div
                        key={series.id}
                        className="final-stage-full-planning__series"
                        style={
                          {
                            "--series-color": series.color,
                          } as React.CSSProperties
                        }
                      >
                        <strong>{series.name}</strong>
                        <div className="final-stage-full-planning__matches">
                          {seriesNodes.map((node) => {
                            const row = rowById.get(node.id);
                            const currentSlotId = isEditing
                              ? manualByNode.get(node.id)
                              : persistedByNode.get(node.id);
                            const slot = currentSlotId
                              ? slotById.get(currentSlotId)
                              : undefined;
                            const locked =
                              row?.published ||
                              row?.resultStatus === "validated";
                            const canEdit = Boolean(
                              isEditing &&
                              !locked &&
                              row?.actualMatchId &&
                              row.teamAId &&
                              row.teamBId,
                            );
                            const common = slot
                              ? isFinalStageSlotCommonForNode({
                                  node,
                                  slot,
                                  availability: workspace.availability,
                                })
                              : false;
                            return (
                              <div
                                key={node.id}
                                className="final-stage-full-planning__match"
                              >
                                <div>
                                  <strong>
                                    {describeFinalStageOpponents({
                                      node,
                                      nodes,
                                      seeds:
                                        workspace.series.find(
                                          (series) =>
                                            series.id === node.seriesId,
                                        )?.seeds ?? [],
                                      crossPools:
                                        workspace.series.find(
                                          (series) =>
                                            series.id === node.seriesId,
                                        )?.crossPools ?? false,
                                    })}
                                  </strong>
                                  <span>
                                    {row?.resultStatus === "validated"
                                      ? "Résultat validé"
                                      : row?.published
                                        ? "Publié"
                                        : slot
                                          ? row?.needsManual
                                            ? "À vérifier manuellement"
                                            : !node.actualMatchId
                                              ? row?.round === "final"
                                                ? "Finale · horaire fixé, équipes à déterminer"
                                                : "Adversaires à déterminer"
                                              : "Planifié"
                                          : !row?.actualMatchId
                                            ? "Adversaires à déterminer"
                                            : "À programmer"}
                                  </span>
                                  {!slot &&
                                    row?.resultStatus !== "validated" && (
                                      <small>
                                        {unprogrammedDiagnostics.get(node.id)}
                                      </small>
                                    )}
                                  {slot &&
                                    workspace.tournament.finalsStartsOn &&
                                    workspace.tournament.finalsEndsOn &&
                                    slot.date >
                                      finalRoundDateWindow({
                                        node,
                                        nodes,
                                        finalsStartsOn:
                                          workspace.tournament.finalsStartsOn,
                                        finalsEndsOn:
                                          workspace.tournament.finalsEndsOn,
                                      }).latest && (
                                      <small>
                                        Dérogation de calendrier : vérifier
                                        l’enchaînement des tours.
                                      </small>
                                    )}
                                </div>

                                {canEdit ? (
                                  <div className="final-stage-full-planning__manual-choice">
                                    <select
                                      value={currentSlotId ?? ""}
                                      disabled={busy}
                                      onChange={(event) =>
                                        changeManualSlot(
                                          node.id,
                                          event.target.value,
                                        )
                                      }
                                    >
                                      <option value="">À programmer</option>
                                      {sortedSlots.map((candidate) => {
                                        const isCommon =
                                          isFinalStageSlotCommonForNode({
                                            node,
                                            slot: candidate,
                                            availability:
                                              workspace.availability,
                                          });
                                        return (
                                          <option
                                            key={candidate.id}
                                            value={candidate.id}
                                          >
                                            {isCommon ? "✓ " : "⚠ "}
                                            {slotLabel(candidate)}
                                          </option>
                                        );
                                      })}
                                      {slot &&
                                        workspace.exceptionalSlotIds.includes(
                                          slot.id,
                                        ) && (
                                          <option value={slot.id}>
                                            Exceptionnel · {slotLabel(slot)}
                                          </option>
                                        )}
                                    </select>
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() =>
                                        exceptionNodeId === node.id
                                          ? setExceptionNodeId(null)
                                          : editExceptionalSlot(node.id, row)
                                      }
                                    >
                                      {exceptionNodeId === node.id
                                        ? "Annuler la saisie"
                                        : "Choisir une autre date / heure"}
                                    </button>
                                    {exceptionNodeId === node.id && (
                                      <div className="final-stage-full-planning__exception-form">
                                        <p>
                                          Créneau exceptionnel, même un samedi
                                          ou avant 17h30. À convenir avec les
                                          équipes.
                                        </p>
                                        <label>
                                          Date
                                          <input
                                            type="date"
                                            value={exceptionDate}
                                            min={
                                              workspace.tournament
                                                .finalsStartsOn ?? undefined
                                            }
                                            max={
                                              workspace.tournament
                                                .finalsEndsOn ?? undefined
                                            }
                                            onChange={(event) =>
                                              setExceptionDate(
                                                event.target.value,
                                              )
                                            }
                                            disabled={busy}
                                          />
                                        </label>
                                        <label>
                                          Début
                                          <input
                                            type="time"
                                            value={exceptionStart}
                                            onChange={(event) =>
                                              setExceptionStart(
                                                event.target.value,
                                              )
                                            }
                                            disabled={busy}
                                          />
                                        </label>
                                        <label>
                                          Fin
                                          <input
                                            type="time"
                                            value={exceptionEnd}
                                            onChange={(event) =>
                                              setExceptionEnd(
                                                event.target.value,
                                              )
                                            }
                                            disabled={busy}
                                          />
                                        </label>
                                        <label>
                                          Terrain
                                          <select
                                            value={exceptionResourceId}
                                            onChange={(event) =>
                                              setExceptionResourceId(
                                                event.target.value,
                                              )
                                            }
                                            disabled={busy}
                                          >
                                            {workspace.resources.map(
                                              (resource) => (
                                                <option
                                                  key={resource.id}
                                                  value={resource.id}
                                                >
                                                  {resource.name}
                                                </option>
                                              ),
                                            )}
                                          </select>
                                        </label>
                                        <button
                                          type="button"
                                          disabled={
                                            busy ||
                                            !exceptionDate ||
                                            !exceptionStart ||
                                            !exceptionEnd ||
                                            !exceptionResourceId ||
                                            exceptionEnd <= exceptionStart
                                          }
                                          onClick={() =>
                                            void saveExceptionalSlot(node)
                                          }
                                        >
                                          Enregistrer ce créneau exceptionnel
                                        </button>
                                        <small>
                                          Enregistrement immédiat de cette
                                          partie uniquement. Enregistre
                                          séparément toute autre modification en
                                          cours.
                                        </small>
                                      </div>
                                    )}
                                  </div>
                                ) : slot ? (
                                  <span
                                    className={
                                      common
                                        ? "final-stage-full-planning__slot"
                                        : "final-stage-full-planning__slot final-stage-full-planning__slot--warning"
                                    }
                                  >
                                    {!common && "⚠ "}
                                    {slotLabel(slot)}
                                  </span>
                                ) : (
                                  <span className="final-stage-full-planning__unscheduled">
                                    À programmer
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {isEditing && (
                  <div className="final-stage-full-planning__manual-actions">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void saveManualRound()}
                    >
                      Enregistrer les modifications de cette étape
                    </button>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </details>
    </section>
  );
}
