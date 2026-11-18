import { useEffect, useMemo, useState } from "react";
import type { CalendarSlot } from "@/features/reservations/domain/calendar";
import {
  tournamentFinalStageAdminService,
  type TournamentFinalFullPlanningWorkspace,
} from "@/features/admin/tournaments/services/tournamentFinalStageAdminService";
import {
  tournamentAdminService,
  type TournamentSummary,
} from "@/features/admin/tournaments/services/tournamentAdminService";

const isFree = (slot: CalendarSlot) =>
  slot.status === "available" || slot.status === "locked";

const keyFor = (slot: CalendarSlot) => `${slot.startsAt}|${slot.endsAt}`;
const nodeKey = (node: {
  seriesId: string;
  roundNumber: number;
  displayOrder: number;
}) => `${node.seriesId}:${node.roundNumber}:${node.displayOrder}`;

function localDateAndTime(isoDate: string, timezone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(isoDate))
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

const titles: Record<string, string> = {
  preliminary: "Barrage",
  round_of_32: "1/16",
  round_of_16: "1/8",
  quarterfinal: "Quart",
  semifinal: "Demi-finale",
  final: "Finale",
};

export function CalendarFinalsAdminPanel({
  slot,
  calendarSlots,
  timezone,
  onUpdated,
}: {
  slot: CalendarSlot;
  calendarSlots: CalendarSlot[];
  timezone: string;
  onUpdated: () => Promise<void>;
}) {
  const projection = slot.finalProjection ?? null;
  const [open, setOpen] = useState(false);
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [tournamentId, setTournamentId] = useState(
    projection?.tournamentId ?? "",
  );
  const [workspace, setWorkspace] =
    useState<TournamentFinalFullPlanningWorkspace | null>(null);
  const [selectedNode, setSelectedNode] = useState("");
  const [selectedTarget, setSelectedTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setWorkspace(null);
    setSelectedNode("");
    setSelectedTarget("");
    setTournaments([]);
    setTournamentId(projection?.tournamentId ?? "");
    setOpen(false);
    setError("");
    setMessage("");
  }, [slot.startsAt, slot.endsAt, projection?.tournamentId]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    if (projection) {
      setTournamentId(projection.tournamentId);
      return;
    }
    setLoading(true);
    void tournamentAdminService
      .list()
      .then((items) => {
        if (!active) return;
        setTournaments(
          items.filter(
            (item) =>
              item.finalsStartsOn &&
              item.finalsEndsOn &&
              item.resourceCount > 0 &&
              !["completed", "cancelled", "archived"].includes(item.status),
          ),
        );
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Liste des tournois indisponible.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, projection]);

  useEffect(() => {
    if (!open || !tournamentId) return;
    let active = true;
    setWorkspace(null);
    setSelectedNode("");
    setLoading(true);
    void tournamentFinalStageAdminService
      .getFullPlanning(tournamentId)
      .then((result) => {
        if (!active) return;
        setWorkspace(result);
        if (projection) {
          setSelectedNode(
            nodeKey({
              seriesId: projection.seriesId,
              roundNumber: projection.roundNumber,
              displayOrder: projection.displayOrder,
            }),
          );
        }
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Impossible de charger le tableau final.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, projection, tournamentId]);

  const seriesById = useMemo(
    () => new Map(workspace?.series.map((series) => [series.id, series]) ?? []),
    [workspace],
  );
  // Manual fallback only: the automatic engine already attempts scheduling
  // when both opponents are known. Do not offer speculative bracket positions
  // or matches that have already received any planned date/slot.
  const unplanned = (workspace?.nodes ?? []).filter(
    (node) =>
      Boolean(node.teamAId && node.teamBId) &&
      !node.resourceId &&
      !node.playDate &&
      !node.startsAt &&
      !node.endsAt &&
      !node.published &&
      node.resultStatus !== "validated",
  );
  const currentNode = workspace?.nodes.find(
    (node) => nodeKey(node) === selectedNode,
  );
  const canModify =
    currentNode &&
    !currentNode.published &&
    currentNode.resultStatus !== "validated" &&
    (Boolean(projection) ||
      (Boolean(currentNode.teamAId && currentNode.teamBId) &&
        unplanned.some((node) => nodeKey(node) === selectedNode))) &&
    Boolean(tournamentId);
  const targets = calendarSlots
    .filter(
      (candidate) =>
        isFree(candidate) &&
        candidate.resourceId === slot.resourceId &&
        keyFor(candidate) !== keyFor(slot),
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const selectedDestination = projection
    ? targets.find((candidate) => keyFor(candidate) === selectedTarget)
    : slot;

  async function save() {
    if (!canModify || !selectedDestination || !workspace || saving) return;
    setSaving(true);
    setError("");
    try {
      const date = localDateAndTime(selectedDestination.startsAt, timezone);
      const end = localDateAndTime(selectedDestination.endsAt, timezone);
      if (end.date !== date.date) {
        throw new Error(
          "Les créneaux traversant minuit ne sont pas pris en charge.",
        );
      }
      await tournamentFinalStageAdminService.setExceptionalManualSlot(
        tournamentId,
        {
          seriesId: currentNode.seriesId,
          roundNumber: currentNode.roundNumber,
          displayOrder: currentNode.displayOrder,
          resourceId: selectedDestination.resourceId,
          playDate: date.date,
          startsAt: date.time,
          endsAt: end.time,
        },
      );
      setMessage(
        "Créneau de phase finale enregistré pour les deux adversaires connus.",
      );
      await onUpdated();
    } catch (reason: unknown) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Impossible de programmer ce créneau.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    if (!projection || !canModify || !workspace || saving) return;
    if (!window.confirm("Déprogrammer ce créneau prévisionnel et le libérer ?"))
      return;
    setSaving(true);
    setError("");
    try {
      await tournamentFinalStageAdminService.saveFullPlanning(
        tournamentId,
        [
          {
            seriesId: currentNode.seriesId,
            roundNumber: currentNode.roundNumber,
            displayOrder: currentNode.displayOrder,
            slotId: null,
            source: null,
          },
        ],
        workspace.slots,
      );
      setMessage("Créneau prévisionnel déprogrammé.");
      await onUpdated();
    } catch (reason: unknown) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Déprogrammation impossible.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="reservation-slot-actions">
      <h3>Phase finale · administration</h3>
      <button
        className="reservation-slot-actions__button"
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        {projection
          ? "Déplacer ou déprogrammer ce créneau"
          : "Programmer une phase finale ici"}
      </button>
      {open && (
        <div className="calendar-finals-admin">
          <p>
            Seules les rencontres dont les deux adversaires sont connus et qui
            n'ont pas été programmées automatiquement sont proposées. Cette
            action ne publie pas de nouvelle rencontre et n'envoie aucune
            notification.
          </p>
          {!projection && (
            <label>
              Tournoi
              <select
                value={tournamentId}
                onChange={(event) => setTournamentId(event.target.value)}
                disabled={loading || saving}
              >
                <option value="">Choisir un tournoi</option>
                {tournaments.map((tournament) => (
                  <option value={tournament.id} key={tournament.id}>
                    {tournament.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {loading && <p role="status">Chargement des positions du tableau…</p>}
          {workspace && (
            <>
              <label>
                Position de phase finale
                <select
                  disabled={Boolean(projection) || saving}
                  value={selectedNode}
                  onChange={(event) => setSelectedNode(event.target.value)}
                >
                  <option value="">Choisir une rencontre à placer</option>
                  {(projection
                    ? workspace.nodes.filter(
                        (node) => nodeKey(node) === selectedNode,
                      )
                    : unplanned
                  ).map((node) => (
                    <option key={nodeKey(node)} value={nodeKey(node)}>
                      {seriesById.get(node.seriesId)?.name ?? "Série"} ·{" "}
                      {titles[node.round] ?? node.round} n°
                      {node.displayOrder + 1}
                      {node.teamALabel && node.teamBLabel
                        ? ` · ${node.teamALabel} — ${node.teamBLabel}`
                        : " · Adversaires à déterminer"}
                      {node.playDate ? ` · ${node.playDate}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              {!projection && unplanned.length === 0 && (
                <p role="status">
                  Aucune rencontre complète ne reste à programmer manuellement
                  pour ce tournoi.
                </p>
              )}
              {projection && (
                <label>
                  Nouveau créneau
                  <select
                    value={selectedTarget}
                    onChange={(event) => setSelectedTarget(event.target.value)}
                    disabled={saving}
                  >
                    <option value="">
                      Choisir un créneau libre dans cette semaine
                    </option>
                    {targets.map((target) => {
                      const start = localDateAndTime(target.startsAt, timezone);
                      return (
                        <option key={keyFor(target)} value={keyFor(target)}>
                          {start.date} · {start.time} ·{" "}
                          {target.status === "locked"
                            ? "réservé / non ouvert"
                            : "libre"}
                        </option>
                      );
                    })}
                  </select>
                </label>
              )}
              {!projection && (
                <p>
                  Créneau sélectionné :{" "}
                  {localDateAndTime(slot.startsAt, timezone).date} ·{" "}
                  {localDateAndTime(slot.startsAt, timezone).time}
                </p>
              )}
              <div className="reservation-slot-actions__list">
                <button
                  type="button"
                  className="reservation-slot-actions__button"
                  disabled={!canModify || !selectedDestination || saving}
                  onClick={() => void save()}
                >
                  {saving ? "Enregistrement…" : "Programmer ici"}
                </button>
                {projection && (
                  <button
                    type="button"
                    className="reservation-slot-actions__button"
                    disabled={!canModify || saving}
                    onClick={() => void clear()}
                  >
                    Déprogrammer
                  </button>
                )}
              </div>
            </>
          )}
          {message && <p role="status">{message}</p>}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </section>
  );
}
