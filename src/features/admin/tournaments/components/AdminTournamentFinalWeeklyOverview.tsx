import { useMemo, useRef, useState } from "react";
import type { TournamentFinalFullPlanningWorkspace } from "../services/tournamentFinalStageAdminService";
import type { PlanningSlot } from "@/features/tournaments/domain/planningEngine";

type WeeklySlot = {
  slot: PlanningSlot;
  kind: "match" | "occupied" | "free";
  title: string;
  detail: string;
  seriesId?: string;
  provisional?: boolean;
  color?: string;
};

const dayFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});
const weekFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});
const toUtcDate = (date: string) => new Date(`${date}T12:00:00Z`);
const toIsoDay = (date: Date) => date.toISOString().slice(0, 10);
const mondayOf = (date: string) => {
  const target = toUtcDate(date);
  const day = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - day);
  return target;
};
const addDays = (date: Date, amount: number) => {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + amount);
  return copy;
};
const slotKey = (slot: {
  resourceId: string;
  date: string;
  startsAt: string;
  endsAt: string;
}) =>
  `${slot.resourceId}|${slot.date}|${slot.startsAt.slice(0, 5)}|${slot.endsAt.slice(0, 5)}`;

const timeText = (value: string) => value.slice(0, 5);

export function AdminTournamentFinalWeeklyOverview({
  workspace,
}: {
  workspace: TournamentFinalFullPlanningWorkspace;
}) {
  const [weekIndex, setWeekIndex] = useState(0);
  const [printError, setPrintError] = useState("");
  const weeklyTableRef = useRef<HTMLTableElement>(null);
  const [seriesFilter, setSeriesFilter] = useState("all");
  const [show, setShow] = useState<"all" | "matches" | "free">("all");

  const first = workspace.tournament.finalsStartsOn;
  const last = workspace.tournament.finalsEndsOn;
  const firstMonday = mondayOf(
    first ?? workspace.weeklySlots[0]?.date ?? "2026-01-01",
  );
  const maxIndex = last
    ? Math.max(
        0,
        Math.round(
          (mondayOf(last).getTime() - firstMonday.getTime()) / 604_800_000,
        ),
      )
    : 0;
  const currentIndex = Math.min(weekIndex, maxIndex);
  const monday = addDays(firstMonday, currentIndex * 7);
  const days = Array.from({ length: 7 }, (_, index) =>
    toIsoDay(addDays(monday, index)),
  );
  const blocked = useMemo(
    () =>
      new Set(
        workspace.weeklyOccupiedSlotIds.map((id) =>
          id
            .split("|")
            .map((part, index) => (index >= 2 ? part.slice(0, 5) : part))
            .join("|"),
        ),
      ),
    [workspace.weeklyOccupiedSlotIds],
  );
  const seriesById = useMemo(
    () => new Map(workspace.series.map((series) => [series.id, series])),
    [workspace.series],
  );
  const slotAssignments = useMemo(() => {
    const bySlot = new Map<
      string,
      TournamentFinalFullPlanningWorkspace["nodes"][number]
    >();
    for (const node of workspace.nodes) {
      if (!node.resourceId || !node.playDate || !node.startsAt || !node.endsAt)
        continue;
      bySlot.set(
        slotKey({
          resourceId: node.resourceId,
          date: node.playDate,
          startsAt: node.startsAt,
          endsAt: node.endsAt,
        }),
        node,
      );
    }
    return bySlot;
  }, [workspace.nodes]);
  const weeklySlots = useMemo(() => {
    const result: WeeklySlot[] = [];
    for (const slot of workspace.weeklySlots) {
      if (!days.includes(slot.date)) continue;
      const key = slotKey(slot);
      const node = slotAssignments.get(key);
      if (node) {
        const series = seriesById.get(node.seriesId);
        const provisional = !node.actualMatchId;
        result.push({
          slot,
          kind: "match",
          title: provisional
            ? `${series?.name ?? "Série"} · adversaires à confirmer`
            : [node.teamALabel, node.teamBLabel].filter(Boolean).join(" / "),
          detail: `${series?.name ?? "Série"} · ${node.round === "preliminary" ? "Barrage" : node.round === "round_of_16" ? "1/8" : node.round === "quarterfinal" ? "1/4" : node.round === "semifinal" ? "1/2" : node.round === "final" ? "Finale" : node.round}${node.published ? " · Publié" : ""}`,
          seriesId: node.seriesId,
          provisional,
          color: series?.color,
        });
      } else if (blocked.has(key)) {
        result.push({
          slot,
          kind: "occupied",
          title: "Créneau occupé",
          detail: "Réservation ou autre rencontre",
        });
      } else {
        result.push({
          slot,
          kind: "free",
          title: "Libre",
          detail: slot.resourceName,
        });
      }
    }
    return result;
  }, [workspace.weeklySlots, days, slotAssignments, seriesById, blocked]);

  const visibleSlots = weeklySlots.filter((entry) => {
    if (show === "matches" && entry.kind !== "match") return false;
    if (show === "free" && entry.kind !== "free") return false;
    if (
      seriesFilter !== "all" &&
      entry.kind === "match" &&
      entry.seriesId !== seriesFilter
    )
      return false;
    return true;
  });
  const hours = [
    ...new Set(visibleSlots.map(({ slot }) => timeText(slot.startsAt))),
  ].sort();
  const countMatches = weeklySlots.filter(
    (slot) => slot.kind === "match",
  ).length;
  const countFree = weeklySlots.filter((slot) => slot.kind === "free").length;
  const countOccupied = weeklySlots.filter(
    (slot) => slot.kind === "occupied",
  ).length;

  const exportWeekAsPdf = () => {
    const source = weeklyTableRef.current;
    if (!source) return;
    // Native print-to-PDF keeps French characters and long team names readable,
    // including tables that flow onto more than one page.
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setPrintError(
        "Le navigateur a bloqué la fenêtre d'export. Autorisez les fenêtres de Pilotoki, puis réessayez.",
      );
      return;
    }
    setPrintError("");
    const document = printWindow.document;
    document.title = `Pilotoki - Planning ${toIsoDay(monday)}`;
    const style = document.createElement("style");
    style.textContent = `
      @page { size: A3 landscape; margin: 11mm; }
      * { box-sizing: border-box; }
      body { font: 10px Arial, sans-serif; color: #17253a; background: white; }
      h1 { font-size: 19px; margin: 0 0 5px; }
      .subheading { font-size: 11px; margin: 0 0 10px; }
      .summary { font-weight: bold; margin: 0 0 9px; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      th, td { border: 1px solid #d4dce7; padding: 4px; vertical-align: top; }
      th { background: #eaf0f6; }
      th:first-child { width: 45px; }
      tr { break-inside: avoid; page-break-inside: avoid; }
      td { overflow-wrap: anywhere; }
      .final-weekly-overview__event {
        display: block; margin-bottom: 3px; padding: 5px;
        border-left: 3px solid #3b82f6; border-radius: 3px;
        break-inside: avoid; page-break-inside: avoid;
      }
      .final-weekly-overview__event--match { background: #ecf3ff; }
      .final-weekly-overview__event--free { background: #e9f7ed; border-color: #198754; }
      .final-weekly-overview__event--occupied { background: #edf0f2; border-color: #64748b; }
      .final-weekly-overview__event strong,
      .final-weekly-overview__event small,
      .final-weekly-overview__event-time { display: block; margin-top: 2px; }
      .final-weekly-overview__unavailable { color: #8b97a7; }
      footer { margin-top: 10px; color: #536274; font-size: 9px; }
      @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    `;
    document.head.appendChild(style);
    const heading = document.createElement("h1");
    heading.textContent = `Pilotoki · ${workspace.tournament.name}`;
    document.body.appendChild(heading);
    const subheading = document.createElement("p");
    subheading.className = "subheading";
    const selectedSeries = workspace.series.find(
      (series) => series.id === seriesFilter,
    );
    subheading.textContent = `Planning hebdomadaire · ${weekFormatter.format(monday)} au ${weekFormatter.format(addDays(monday, 6))} · ${selectedSeries?.name ?? "Toutes les séries"} · ${show === "matches" ? "Parties uniquement" : show === "free" ? "Créneaux libres uniquement" : "Tous les créneaux"}`;
    document.body.appendChild(subheading);
    const summary = document.createElement("p");
    summary.className = "summary";
    summary.textContent = `${visibleSlots.filter((item) => item.kind === "match").length} parties / positions · ${visibleSlots.filter((item) => item.kind === "free").length} libres · ${visibleSlots.filter((item) => item.kind === "occupied").length} occupés ailleurs`;
    document.body.appendChild(summary);
    document.body.appendChild(source.cloneNode(true));
    const footer = document.createElement("footer");
    footer.textContent =
      "Planning prévisionnel. Les rencontres provisoires restent à confirmer. Les créneaux non configurés ne sont pas considérés comme libres.";
    document.body.appendChild(footer);
    printWindow.focus();
    printWindow.print();
  };

  return (
    <section
      className="final-weekly-overview"
      aria-label="Planning hebdomadaire des finales"
    >
      <header className="final-weekly-overview__header">
        <div>
          <p className="final-weekly-overview__eyebrow">Vue globale</p>
          <h4>Planning semaine par semaine</h4>
          <p>Parties programmées, positions provisoires et créneaux libres.</p>
        </div>
        <div className="final-weekly-overview__navigation">
          <button
            type="button"
            onClick={exportWeekAsPdf}
            aria-label="Exporter le planning de cette semaine en PDF"
            title="Ouvre l'impression : choisir Enregistrer au format PDF"
          >
            Exporter la semaine en PDF
          </button>
          <button
            type="button"
            disabled={currentIndex === 0}
            onClick={() => setWeekIndex(currentIndex - 1)}
            aria-label="Semaine précédente"
          >
            ←
          </button>
          <strong>
            Semaine du {weekFormatter.format(monday)} au{" "}
            {weekFormatter.format(addDays(monday, 6))}
          </strong>
          <button
            type="button"
            disabled={currentIndex >= maxIndex}
            onClick={() => setWeekIndex(currentIndex + 1)}
            aria-label="Semaine suivante"
          >
            →
          </button>
        </div>
      </header>
      <div className="final-weekly-overview__summary">
        <span>
          <strong>{countMatches}</strong> parties / positions
        </span>
        <span>
          <strong>{countFree}</strong> libres
        </span>
        <span>
          <strong>{countOccupied}</strong> occupés ailleurs
        </span>
      </div>
      <div className="final-weekly-overview__filters">
        <label>
          Série
          <select
            value={seriesFilter}
            onChange={(event) => setSeriesFilter(event.target.value)}
          >
            <option value="all">Toutes les séries</option>
            {workspace.series.map((series) => (
              <option key={series.id} value={series.id}>
                {series.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Afficher
          <select
            value={show}
            onChange={(event) =>
              setShow(
                event.target.value === "matches" ||
                  event.target.value === "free"
                  ? event.target.value
                  : "all",
              )
            }
          >
            <option value="all">Tout le planning</option>
            <option value="matches">Parties uniquement</option>
            <option value="free">Créneaux libres uniquement</option>
          </select>
        </label>
      </div>
      {printError && (
        <p
          role="alert"
          className="qualification-alert qualification-alert--error"
        >
          {printError}
        </p>
      )}
      <div className="final-weekly-overview__scroll">
        <table ref={weeklyTableRef} className="final-weekly-overview__table">
          <thead>
            <tr>
              <th scope="col">Heure</th>
              {days.map((day) => (
                <th scope="col" key={day}>
                  {dayFormatter.format(toUtcDate(day))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hours.map((hour) => (
              <tr key={hour}>
                <th scope="row">{hour}</th>
                {days.map((day) => {
                  const entries = visibleSlots.filter(
                    ({ slot }) =>
                      slot.date === day && timeText(slot.startsAt) === hour,
                  );
                  return (
                    <td key={day}>
                      {entries.length === 0 ? (
                        <span className="final-weekly-overview__unavailable">
                          —
                        </span>
                      ) : (
                        entries.map((entry) => (
                          <div
                            key={entry.slot.id}
                            className={`final-weekly-overview__event final-weekly-overview__event--${entry.kind}`}
                            style={
                              entry.kind === "match"
                                ? { borderLeftColor: entry.color ?? "#2563eb" }
                                : undefined
                            }
                            title={`${timeText(entry.slot.startsAt)}–${timeText(entry.slot.endsAt)} · ${entry.title} · ${entry.detail}`}
                          >
                            <span className="final-weekly-overview__event-time">
                              {timeText(entry.slot.startsAt)}–
                              {timeText(entry.slot.endsAt)}
                            </span>
                            <strong>{entry.title}</strong>
                            <small>
                              {entry.detail}
                              {entry.provisional ? " · Provisoire" : ""}
                            </small>
                          </div>
                        ))
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {hours.length === 0 && (
          <p className="final-weekly-overview__empty">
            Aucun créneau correspondant aux filtres pour cette semaine.
          </p>
        )}
      </div>
      <p className="final-weekly-overview__note">
        « Libre » signifie qu'aucune affectation du tournoi ni réservation
        connue n'occupe le créneau configuré. Les heures sans créneau configuré
        sont indiquées par « — » ; les places provisoires restent à confirmer
        avec les joueurs. Vue en lecture seule : aucune modification ni
        notification.
      </p>
    </section>
  );
}
