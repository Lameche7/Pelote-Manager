import { useEffect, useMemo, useState } from "react";
import { PlanningMatchActions } from "../components/PlanningMatchActions";
import { CalendarWeekGrid } from "../components/CalendarWeekGrid";
import {
  addDays,
  buildWeekDays,
  formatTime,
  groupSlotsByLocalDate,
  toDateInputValue,
  type CalendarSlot,
  type ReservableResource,
} from "../domain/calendar";
import { reservationCalendarService } from "../services/reservationCalendarService";
import "./ReservationsPage.css";
import "./ReservationsResponsive.css";
import "./ReservationLockedSlots.css";

const ALL = "all";
const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function monday() {
  const date = new Date();
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

export function ClubPlanningPage({ clubSlug }: { clubSlug: string | null }) {
  const [resources, setResources] = useState<ReservableResource[]>([]);
  const [selection, setSelection] = useState(ALL);
  const [anchor, setAnchor] = useState(monday);
  const [slots, setSlots] = useState<CalendarSlot[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(true);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [inspected, setInspected] = useState<CalendarSlot | null>(null);
  const days = useMemo(() => buildWeekDays(anchor), [anchor]);
  const from = toDateInputValue(days[0]);
  const to = toDateInputValue(days[6]);

  useEffect(() => {
    let active = true;
    setResourcesLoading(true);
    setResources([]);
    setSlots([]);
    setError("");
    void reservationCalendarService
      .listResources(clubSlug)
      .then((items) => {
        if (!active) return;
        setResources(items);
        setSelection(items.length > 1 ? ALL : (items[0]?.id ?? ALL));
      })
      .catch(() => {
        if (active) setError("Impossible de charger les installations.");
      })
      .finally(() => {
        if (active) setResourcesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [clubSlug]);

  useEffect(() => {
    let active = true;
    setSlots([]);
    setInspected(null);
    setSlotsLoading(true);
    if (!resources.length) {
      setSlotsLoading(false);
      return;
    }
    setError("");
    const selected = resources.filter(
      (resource) => selection === ALL || resource.id === selection,
    );
    void Promise.all(
      selected.map(async (resource) => {
        const entries = await reservationCalendarService.listSlots(
          resource.id,
          from,
          to,
          true,
        );
        return entries.filter(
          (slot) =>
            slot.resourceId === resource.id &&
            slot.occupationType === "match" &&
            slot.status === "occupied",
        );
      }),
    )
      .then((groups) => {
        if (!active) return;
        setSlots(
          groups
            .flat()
            .sort(
              (a, b) =>
                Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
                a.resourceId.localeCompare(b.resourceId),
            ),
        );
      })
      .catch(() => {
        if (active) setError("Impossible de charger le planning.");
      })
      .finally(() => {
        if (active) setSlotsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [resources, selection, from, to, refreshVersion]);

  const labels = useMemo(
    () => new Map(resources.map((item) => [item.id, item.name])),
    [resources],
  );
  const timezones = useMemo(
    () => new Map(resources.map((item) => [item.id, item.timezone])),
    [resources],
  );
  const byDay = useMemo(() => {
    const grouped = new Map<string, CalendarSlot[]>();
    for (const slot of slots) {
      const local = groupSlotsByLocalDate(
        [slot],
        timezones.get(slot.resourceId) ?? "Europe/Paris",
      );
      for (const [day, entries] of local) {
        grouped.set(day, [...(grouped.get(day) ?? []), ...entries]);
      }
    }
    return grouped;
  }, [slots, timezones]);

  return (
    <section className="reservation-calendar">
      <div className="reservation-calendar__header">
        <div>
          <h1>Planning des tournois</h1>
          <p>Rencontres programmées sur les installations du club.</p>
        </div>
        {resources.length > 1 && (
          <label>
            Installation
            <select
              value={selection}
              onChange={(event) => setSelection(event.target.value)}
            >
              <option value={ALL}>Toutes les installations</option>
              {resources.map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="reservation-calendar__toolbar">
        <button type="button" onClick={() => setAnchor(addDays(anchor, -7))}>
          Semaine précédente
        </button>
        <button type="button" onClick={() => setAnchor(monday())}>
          Aujourd’hui
        </button>
        <strong>
          {dateFormatter.format(days[0])} – {dateFormatter.format(days[6])}
        </strong>
        <button type="button" onClick={() => setAnchor(addDays(anchor, 7))}>
          Semaine suivante
        </button>
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : resourcesLoading || slotsLoading ? (
        <p role="status">Chargement du planning…</p>
      ) : (
        <CalendarWeekGrid
          weekDays={days}
          slotsByDay={byDay}
          timezone="Europe/Paris"
          resourceLabels={labels}
          resourceTimezones={timezones}
          championshipMatchSelected={false}
          readOnly
          canInspectLocked={false}
          onBook={() => undefined}
          onInspect={setInspected}
        />
      )}
      {inspected && (
        <section aria-label="Détails de la rencontre">
          <h2>{inspected.bookedByName ?? "Partie de tournoi"}</h2>
          <p>
            {labels.get(inspected.resourceId)} ·{" "}
            {formatTime(
              inspected.startsAt,
              timezones.get(inspected.resourceId) ?? "Europe/Paris",
            )}
          </p>
          {inspected.resultDisplay && (
            <p>Résultat : {inspected.resultDisplay}</p>
          )}
          {inspected.refereeName && <p>Arbitre : {inspected.refereeName}</p>}
          <PlanningMatchActions
            key={`${inspected.resourceId}-${inspected.startsAt}-${inspected.endsAt}`}
            slot={inspected}
            clubSlug={clubSlug}
            clubId={
              resources.find((resource) => resource.id === inspected.resourceId)
                ?.clubId ?? null
            }
            onUpdated={() => setRefreshVersion((value) => value + 1)}
          />
          <button type="button" onClick={() => setInspected(null)}>
            Fermer
          </button>
        </section>
      )}
    </section>
  );
}
