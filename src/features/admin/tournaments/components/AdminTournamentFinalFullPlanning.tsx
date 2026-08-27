import { useCallback, useEffect, useMemo, useState } from "react";
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
  generateFullFinalStagePlanning,
  validateFullFinalStagePlanning,
} from "@/features/tournaments/domain/finalStageFullPlanningEngine";
import type { PlanningSlot } from "@/features/tournaments/domain/planningEngine";

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

const nodeTitle = (
  node: FinalStagePlanningNode,
  row: TournamentFinalFullPlanningNodeRow | undefined,
) => {
  if (row?.teamALabel && row.teamBLabel) {
    return `${row.teamALabel} — ${row.teamBLabel}`;
  }
  if (node.roundNumber === 0 && node.possibleTeamLabels.length === 2) {
    return `${node.possibleTeamLabels[0]} — ${node.possibleTeamLabels[1]}`;
  }
  return "Participants à déterminer";
};

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
  const slotById = useMemo(
    () => new Map((workspace?.slots ?? []).map((slot) => [slot.id, slot])),
    [workspace?.slots],
  );
  const sortedSlots = useMemo(
    () =>
      [...(workspace?.slots ?? [])].sort((left, right) =>
        slotSortKey(left).localeCompare(slotSortKey(right)),
      ),
    [workspace?.slots],
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
  const plannedCount = persistedAssignments.length;
  const unplannedCount = Math.max(0, nodes.length - plannedCount);

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

  const autoPlan = () =>
    run(async () => {
      if (!workspace) return "";
      const existing = assignmentsFromWorkspace(workspace);
      const fixedNodeIds = workspace.nodes
        .filter(
          (row) =>
            row.published ||
            row.resultStatus === "validated" ||
            row.source === "manual",
        )
        .map(rowNodeId);
      const proposal = generateFullFinalStagePlanning({
        nodes,
        slots: workspace.slots,
        availability: workspace.availability,
        existingAssignments: existing,
        fixedNodeIds,
        minimumRestMinutes: workspace.tournament.minimumRestMinutes,
        iterations: 600,
      });
      const proposedByNode = assignmentMap(proposal.assignments);
      const updates: TournamentFinalFullPlanningUpdate[] = workspace.nodes
        .filter((row) => row.resultStatus !== "validated" && !row.published)
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
      return missing > 0
        ? `Planning complet enregistré : ${count} partie(s) placée(s), ${missing} partie(s) restent « À programmer » manuellement.`
        : `Planning complet enregistré : les ${count} parties de toutes les séries sont placées.`;
    });

  const openManualRound = (roundNumber: number) => {
    if (!workspace) return;
    setManualAssignments(assignmentsFromWorkspace(workspace));
    setEditingRound(roundNumber);
    setError("");
    setMessage(
      "Tous les créneaux Finals sont proposés. ⚠ signale un créneau hors disponibilités déclarées, mais l’admin peut le forcer.",
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
          row.resultStatus !== "validated" &&
          !row.published,
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
    <section className="final-stage-full-planning">
      <header className="final-stage-full-planning__header">
        <div>
          <p>Organisation globale</p>
          <h3>Planning complet des phases finales</h3>
        </div>
        <div className="final-stage-full-planning__summary">
          <strong>
            {plannedCount}/{nodes.length}
          </strong>
          <span>
            {unplannedCount > 0 ? `${unplannedCount} à programmer` : "Complet"}
          </span>
        </div>
      </header>

      <p className="final-stage-full-planning__hint">
        Toutes les séries et toutes les étapes partagent les mêmes créneaux
        Finals. L’automatique place ce qu’il peut avec les disponibilités
        déclarées ; le reste est conservé « À programmer ».
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

      <div className="final-stage-full-planning__actions">
        <button type="button" disabled={busy} onClick={() => void autoPlan()}>
          {busy ? "Calcul…" : "Compléter automatiquement le planning"}
        </button>
      </div>

      <div className="final-stage-full-planning__stages">
        {stages.map((stage) => {
          const editableNodes = stage.nodes.filter((node) => {
            const row = rowById.get(node.id);
            return row?.resultStatus !== "validated" && !row?.published;
          });
          const isEditing = editingRound === stage.roundNumber;
          return (
            <section
              key={stage.roundNumber}
              className="final-stage-full-planning__stage"
            >
              <header>
                <div>
                  <p>Étape {stage.roundNumber + 1}</p>
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
                            row?.published || row?.resultStatus === "validated";
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
                                <strong>{nodeTitle(node, row)}</strong>
                                <span>
                                  {row?.resultStatus === "validated"
                                    ? "Résultat validé"
                                    : row?.published
                                      ? "Publié"
                                      : slot
                                        ? row?.needsManual
                                          ? "À vérifier manuellement"
                                          : "Planifié"
                                        : "À programmer"}
                                </span>
                              </div>

                              {isEditing && !locked ? (
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
                                        availability: workspace.availability,
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
                                </select>
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
    </section>
  );
}
