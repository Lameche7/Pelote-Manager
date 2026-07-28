import { useEffect, useMemo, useState } from "react";
import {
  addDays,
  buildWeekDays,
  formatTime,
  groupSlotsByLocalDate,
  startOfIsoWeek,
  toDateInputValue,
  type CalendarSlot,
  type ReservableResource,
} from "@/features/reservations/domain/calendar";
import { reservationCalendarService } from "@/features/reservations/services/reservationCalendarService";

const dayFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

const rangeFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function CalendarSkeleton() {
  return (
    <div className="reservation-calendar__skeleton" aria-label="Chargement du calendrier">
      {Array.from({ length: 7 }, (_, index) => (
        <div className="reservation-calendar__skeleton-column" key={index} />
      ))}
    </div>
  );
}

function SlotCard({ slot, timezone }: { slot: CalendarSlot; timezone: string }) {
  const isAvailable = slot.status === "available";

  return (
    <div
      className={`reservation-slot reservation-slot--${slot.status}`}
      aria-label={`${formatTime(slot.startsAt, timezone)} : ${
        isAvailable ? "libre" : "occupé"
      }`}
    >
      <strong>{formatTime(slot.startsAt, timezone)}</strong>
      <span>{isAvailable ? "Libre" : "Occupé"}</span>
    </div>
  );
}

export function ReservationsPage() {
  const [resources, setResources] = useState<ReservableResource[]>([]);
  const [resourceId, setResourceId] = useState("");
  const [anchorDate, setAnchorDate] = useState(() => startOfIsoWeek(new Date()));
  const [slots, setSlots] = useState<CalendarSlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedResource = resources.find((resource) => resource.id === resourceId);
  const weekDays = useMemo(() => buildWeekDays(anchorDate), [anchorDate]);
  const weekStart = weekDays[0];
  const weekEnd = weekDays[6];
  const slotsByDay = useMemo(
    () =>
      groupSlotsByLocalDate(slots, selectedResource?.timezone ?? "Europe/Paris"),
    [slots, selectedResource?.timezone],
  );

  useEffect(() => {
    let isCurrent = true;

    void reservationCalendarService
      .listResources()
      .then((availableResources) => {
        if (!isCurrent) return;
        setResources(availableResources);
        setResourceId((current) => current || availableResources[0]?.id || "");
      })
      .catch(() => {
        if (isCurrent) setErrorMessage("Le calendrier est momentanément indisponible.");
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    if (!resourceId) return;

    let isCurrent = true;
    setIsLoading(true);
    setErrorMessage(null);

    void reservationCalendarService
      .listSlots(
        resourceId,
        toDateInputValue(weekStart),
        toDateInputValue(weekEnd),
      )
      .then((availableSlots) => {
        if (isCurrent) setSlots(availableSlots);
      })
      .catch(() => {
        if (isCurrent) setErrorMessage("Impossible de charger les disponibilités.");
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [resourceId, weekStart.getTime(), weekEnd.getTime()]);

  return (
    <section className="reservation-calendar">
      <div className="reservation-calendar__header">
        <div>
          <p className="reservation-calendar__eyebrow">Réservations du trinquet</p>
          <h1>Calendrier des disponibilités</h1>
          <p>Consultez les créneaux libres avant de réserver.</p>
        </div>

        {resources.length > 1 && (
          <label>
            Terrain
            <select value={resourceId} onChange={(event) => setResourceId(event.target.value)}>
              {resources.map((resource) => (
                <option value={resource.id} key={resource.id}>
                  {resource.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="reservation-calendar__toolbar" aria-label="Navigation du calendrier">
        <button type="button" onClick={() => setAnchorDate(addDays(anchorDate, -7))}>
          Semaine précédente
        </button>
        <button type="button" onClick={() => setAnchorDate(startOfIsoWeek(new Date()))}>
          Aujourd’hui
        </button>
        <strong>
          {rangeFormatter.format(weekStart)} – {rangeFormatter.format(weekEnd)}
        </strong>
        <button type="button" onClick={() => setAnchorDate(addDays(anchorDate, 7))}>
          Semaine suivante
        </button>
      </div>

      {errorMessage && (
        <div className="reservation-calendar__message reservation-calendar__message--error" role="alert">
          {errorMessage}
        </div>
      )}

      {isLoading ? (
        <CalendarSkeleton />
      ) : resources.length === 0 ? (
        <div className="reservation-calendar__message">
          Aucun terrain n’est encore ouvert à la réservation.
        </div>
      ) : (
        <div className="reservation-calendar__grid">
          {weekDays.map((day) => {
            const dayKey = toDateInputValue(day);
            const daySlots = slotsByDay.get(dayKey) ?? [];

            return (
              <article className="reservation-calendar__day" key={dayKey}>
                <h2>{dayFormatter.format(day)}</h2>
                {daySlots.length > 0 ? (
                  <div className="reservation-calendar__slots">
                    {daySlots.map((slot) => (
                      <SlotCard
                        key={`${slot.startsAt}-${slot.endsAt}`}
                        slot={slot}
                        timezone={selectedResource?.timezone ?? "Europe/Paris"}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="reservation-calendar__closed">Fermé</p>
                )}
              </article>
            );
          })}
        </div>
      )}

      <div className="reservation-calendar__legend" aria-label="Légende">
        <span><i className="reservation-calendar__dot reservation-calendar__dot--available" /> Libre</span>
        <span><i className="reservation-calendar__dot reservation-calendar__dot--occupied" /> Occupé</span>
        <span><i className="reservation-calendar__dot reservation-calendar__dot--closed" /> Fermé</span>
      </div>
    </section>
  );
}
