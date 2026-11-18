import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, RefreshCw, AlertTriangle } from "lucide-react";
import {
  tournamentFinalStageAdminService,
  type TournamentFinalFullPlanningNodeRow,
  type TournamentFinalFullPlanningWorkspace,
} from "@/features/admin/tournaments/services/tournamentFinalStageAdminService";
import type { PlanningSlot } from "@/features/tournaments/domain/planningEngine";
import { supabase } from "@/infrastructure/supabase/client";
import "./AdminFinalsCommandCenter.css";

const rounds: Record<string, string> = {
  preliminary: "Barrage",
  round_of_32: "Seizième",
  round_of_16: "Huitième",
  quarterfinal: "Quart",
  semifinal: "Demi-finale",
  final: "Finale",
};
const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const dateLabel = (date: string) =>
  dateFormatter.format(new Date(date + "T12:00:00Z"));
const dateShift = (date: string, days: number) => {
  const value = new Date(date + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const startOfWeek = (date: string) => {
  const weekday = new Date(date + "T12:00:00Z").getUTCDay();
  return dateShift(date, -((weekday + 6) % 7));
};
const slotKey = (slot: { date: string; startsAt: string; endsAt: string }) =>
  `${slot.date}|${slot.startsAt.slice(0, 5)}|${slot.endsAt.slice(0, 5)}`;
const nodeId = (node: TournamentFinalFullPlanningNodeRow) =>
  `${node.seriesId}:${node.roundNumber}:${node.displayOrder}`;

function fixtureName(node: TournamentFinalFullPlanningNodeRow) {
  if (node.teamALabel && node.teamBLabel) {
    return `${node.teamALabel} contre ${node.teamBLabel}`;
  }
  return "Adversaires en attente de qualification";
}

function availabilityFor(
  node: TournamentFinalFullPlanningNodeRow,
  slot: PlanningSlot,
  workspace: TournamentFinalFullPlanningWorkspace,
) {
  if (!node.teamAId || !node.teamBId) return false;
  return [node.teamAId, node.teamBId].every((teamId) =>
    workspace.availability
      .find((entry) => entry.teamId === teamId)
      ?.slots.some((entry) => slotKey(entry) === slotKey(slot)),
  );
}

export function AdminFinalsCommandCenter({
  tournamentId,
  focusMatchId,
}: {
  tournamentId: string;
  focusMatchId?: string | null;
}) {
  const [workspace, setWorkspace] =
    useState<TournamentFinalFullPlanningWorkspace | null>(null);
  const [selected, setSelected] = useState("");
  const [selectedSlot, setSelectedSlot] = useState("");
  const [week, setWeek] = useState(startOfWeek(new Date().toISOString().slice(0, 10)));
  const [filter, setFilter] = useState("all");
  const [seriesFilter, setSeriesFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    const data = await tournamentFinalStageAdminService.getFullPlanning(tournamentId);
    setWorkspace(data);
    return data;
  }, [tournamentId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void tournamentFinalStageAdminService
      .getFullPlanning(tournamentId)
      .then((data) => {
        if (!active) return;
        setWorkspace(data);
        const target =
          data.nodes.find((node) => node.actualMatchId === focusMatchId) ??
          data.nodes.find((node) => node.actualMatchId && !node.published && node.resultStatus !== "validated");
        if (target) {
          setSelected(nodeId(target));
          if (target.playDate) setWeek(startOfWeek(target.playDate));
          else if (focusMatchId && data.tournament.finalsStartsOn)
            setWeek(startOfWeek(data.tournament.finalsStartsOn));
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Impossible de charger le calendrier des finales.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [tournamentId, focusMatchId]);

  const names = useMemo(
    () => new Map(workspace?.series.map((series) => [series.id, series]) ?? []),
    [workspace],
  );
  const visibleNodes = useMemo(() => {
    const source = workspace?.nodes ?? [];
    return source.filter((node) => {
      if (seriesFilter !== "all" && node.seriesId !== seriesFilter) return false;
      if (filter === "waiting") return !node.actualMatchId;
      if (filter === "todo") return Boolean(node.actualMatchId && !node.published && node.resultStatus !== "validated");
      if (filter === "done") return node.resultStatus === "validated";
      if (filter === "published") return node.published && node.resultStatus !== "validated";
      return true;
    }).sort((a, b) => {
      const dateA = a.playDate ?? "9999-12-31";
      const dateB = b.playDate ?? "9999-12-31";
      return dateA.localeCompare(dateB) || a.roundNumber - b.roundNumber || a.displayOrder - b.displayOrder;
    });
  }, [workspace, filter, seriesFilter]);

  const current = workspace?.nodes.find((node) => nodeId(node) === selected);
  const currentSeries = current ? names.get(current.seriesId) : null;
  const editable = Boolean(current?.actualMatchId && current.teamAId && current.teamBId && !current.published && current.resultStatus !== "validated");
  const dayList = Array.from({ length: 7 }, (_, index) => dateShift(week, index));
  const slots = (workspace?.weeklySlots ?? [])
    .filter((slot) => dayList.includes(slot.date))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startsAt.localeCompare(b.startsAt) || a.resourceName.localeCompare(b.resourceName));
  const occupied = new Set(workspace?.weeklyOccupiedSlotIds ?? []);
  const used = workspace?.nodes.filter((node) => node.resourceId && node.playDate && node.startsAt && node.endsAt) ?? [];
  const getNodeAt = (slot: PlanningSlot) => used.find(
    (node) => node.resourceId === slot.resourceId && node.playDate === slot.date
      && node.startsAt?.slice(0, 5) === slot.startsAt.slice(0, 5)
      && node.endsAt?.slice(0, 5) === slot.endsAt.slice(0, 5),
  );
  const targetSlot = slots.find((slot) => slot.id === selectedSlot);
  const targetMatch = targetSlot ? getNodeAt(targetSlot) : undefined;
  const occupiedByOther = targetSlot
    ? (occupied.has(targetSlot.id) || Boolean(targetMatch && nodeId(targetMatch) !== selected))
    : false;
  const compatible = Boolean(current && targetSlot && workspace && availabilityFor(current, targetSlot, workspace));
  const slotIsValid = Boolean(editable && targetSlot && compatible && !occupiedByOther);
  const stats = {
    toProgram: workspace?.nodes.filter((node) => node.actualMatchId && !node.published && node.resultStatus !== "validated").length ?? 0,
    published: workspace?.nodes.filter((node) => node.published && node.resultStatus !== "validated").length ?? 0,
    played: workspace?.nodes.filter((node) => node.resultStatus === "validated").length ?? 0,
    future: workspace?.nodes.filter((node) => !node.actualMatchId).length ?? 0,
  };

  async function schedule() {
    if (!current || !targetSlot || !slotIsValid || !workspace || !current.actualMatchId) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await tournamentFinalStageAdminService.setExceptionalManualSlot(tournamentId, {
        seriesId: current.seriesId,
        roundNumber: current.roundNumber,
        displayOrder: current.displayOrder,
        resourceId: targetSlot.resourceId,
        playDate: targetSlot.date,
        startsAt: targetSlot.startsAt.slice(0, 5),
        endsAt: targetSlot.endsAt.slice(0, 5),
      });
      const response = await supabase.rpc("admin_retry_tournament_final_match_publication", {
        target_match_id: current.actualMatchId,
      });
      if (response.error) throw response.error;
      setNotice(response.data === true
        ? "Partie programmée et publiée : les joueurs concernés sont notifiés."
        : "Créneau enregistré, mais publication non confirmée. Vérifiez les contraintes du tableau et l'alerte administrateur.");
      setSelectedSlot("");
      await refresh();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Impossible de programmer cette rencontre.");
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p role="status">Chargement du planning vivant des phases finales…</p>;
  if (!workspace) return <p role="alert">{error || "Le planning est indisponible."}</p>;

  return (
    <section className="finals-hub" aria-label="Planning vivant des phases finales">
      <header className="finals-hub__header">
        <div>
          <h2>Planning des phases finales</h2>
          <p>Une vue unique : parties jouées, programmées et à placer. Les futurs adversaires restent dans le tableau, sans bloquer de terrain.</p>
        </div>
        <button type="button" disabled={saving} onClick={() => void refresh()}><RefreshCw size={17}/> Actualiser</button>
      </header>
      <div className="finals-hub__stats">
        <button type="button" onClick={() => setFilter("todo")}><strong>{stats.toProgram}</strong> À programmer</button>
        <button type="button" onClick={() => setFilter("published")}><strong>{stats.published}</strong> Programmées</button>
        <button type="button" onClick={() => setFilter("done")}><strong>{stats.played}</strong> Jouées</button>
        <button type="button" onClick={() => setFilter("waiting")}><strong>{stats.future}</strong> À venir</button>
      </div>
      {error && <p role="alert" className="finals-hub__error">{error}</p>}
      {notice && <p role="status" className="finals-hub__notice">{notice}</p>}
      <div className="finals-hub__layout">
        <div className="finals-hub__matches">
          <div className="finals-hub__selectors">
            <label>Afficher
              <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                <option value="all">Toutes les rencontres</option>
                <option value="todo">À programmer</option>
                <option value="published">Programmées</option>
                <option value="done">Jouées</option>
                <option value="waiting">Adversaires inconnus</option>
              </select>
            </label>
            <label>Série
              <select value={seriesFilter} onChange={(event) => setSeriesFilter(event.target.value)}>
                <option value="all">Toutes les séries</option>
                {workspace.series.map((series) => <option key={series.id} value={series.id}>{series.name}</option>)}
              </select>
            </label>
          </div>
          <div className="finals-hub__match-list">
            {visibleNodes.map((node) => {
              const series = names.get(node.seriesId);
              const status = node.resultStatus === "validated" ? "Jouée" : node.published ? "Publiée" : node.actualMatchId ? "À programmer" : "Qualification en cours";
              return (
                <button key={nodeId(node)} type="button"
                  className={`finals-hub__match ${selected === nodeId(node) ? "finals-hub__match--selected" : ""}`}
                  style={{ borderLeftColor: series?.color ?? "#64748b" }}
                  onClick={() => {
                    setSelected(nodeId(node)); setSelectedSlot("");
                    if (node.playDate) setWeek(startOfWeek(node.playDate));
                  }}
                >
                  <span className="finals-hub__match-top">{series?.name ?? "Série"} · {rounds[node.round] ?? node.round} n°{node.displayOrder + 1}<em>{status}</em></span>
                  <strong>{fixtureName(node)}</strong>
                  {node.playDate && <small>{dateLabel(node.playDate)} · {node.startsAt?.slice(0, 5)}{node.published ? " · Confirmée" : " · Non publiée"}</small>}
                </button>
              );
            })}
            {visibleNodes.length === 0 && <p>Aucune rencontre dans ce filtre.</p>}
          </div>
        </div>
        <div className="finals-hub__calendar">
          {current && (
            <div className="finals-hub__selection">
              <strong>{currentSeries?.name} · {rounds[current.round] ?? current.round}</strong>
              <p>{fixtureName(current)}</p>
              <small>{current.resultStatus === "validated" ? "Résultat validé : rencontre terminée." : current.published ? "Rencontre déjà publiée : horaire protégé." : editable ? "Choisissez un créneau disponible ci-dessous." : "En attente des adversaires, aucune réservation possible."}</small>
            </div>
          )}
          <div className="finals-hub__week">
            <button type="button" aria-label="Semaine précédente" onClick={() => {setWeek(dateShift(week,-7));setSelectedSlot("");}}><ChevronLeft size={20}/></button>
            <h3><CalendarDays size={18}/> {dateLabel(week)} – {dateLabel(dateShift(week,6))}</h3>
            <button type="button" aria-label="Semaine suivante" onClick={() => {setWeek(dateShift(week,7));setSelectedSlot("");}}><ChevronRight size={20}/></button>
          </div>
          <div className="finals-hub__days">
            {dayList.map((day) => (
              <section key={day} className="finals-hub__day">
                <h4>{dateLabel(day)}</h4>
                {slots.filter((slot) => slot.date === day).map((slot) => {
                  const planned = getNodeAt(slot);
                  const label = planned ? fixtureName(planned) : occupied.has(slot.id) ? "Déjà occupé" : "Libre";
                  const conflict = occupied.has(slot.id) || Boolean(planned && nodeId(planned) !== selected);
                  const common = Boolean(current && workspace && availabilityFor(current, slot, workspace));
                  const availableToChoose = editable && !conflict;
                  return (
                    <button key={slot.id} type="button" disabled={!availableToChoose}
                      onClick={() => setSelectedSlot(slot.id)}
                      className={`finals-hub__slot ${planned || occupied.has(slot.id) ? "finals-hub__slot--busy" : "finals-hub__slot--free"} ${selectedSlot === slot.id ? "finals-hub__slot--selected" : ""}`}
                    >
                      <strong>{slot.startsAt.slice(0, 5)}</strong>
                      <span>{label}</span>
                      <small>{slot.resourceName}</small>
                      {availableToChoose && <small>{common ? "✓ Disponibilités communes" : "⚠ Disponibilités incompatibles"}</small>}
                    </button>
                  );
                })}
                {!slots.some((slot) => slot.date === day) && <p className="finals-hub__empty-day">Aucun créneau</p>}
              </section>
            ))}
          </div>
          {current && editable && (
            <div className="finals-hub__confirm">
              {targetSlot ? (
                <>
                  <p><strong>{dateLabel(targetSlot.date)} à {targetSlot.startsAt.slice(0, 5)}</strong> · {targetSlot.resourceName}</p>
                  <p className={slotIsValid ? "finals-hub__good" : "finals-hub__warning"}>
                    {occupiedByOther ? <><AlertTriangle size={17}/> Créneau occupé</> : compatible ? <><CheckCircle2 size={17}/> Disponible pour les deux équipes</> : <><AlertTriangle size={17}/> Indisponible selon les déclarations des joueurs</>}
                  </p>
                </>
              ) : <p>Sélectionnez un créneau pour vérifier les disponibilités des deux équipes.</p>}
              <button type="button" disabled={!slotIsValid || saving} onClick={() => void schedule()}>
                {saving ? "Programmation…" : "Programmer et publier cette rencontre"}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
