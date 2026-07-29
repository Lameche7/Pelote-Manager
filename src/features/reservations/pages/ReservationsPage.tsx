import { useEffect, useMemo, useState } from "react";
import {
  formatPrice,
  getBookingErrorMessage,
  validateGuestContact,
  type BookingFormErrors,
  type GuestContact,
  type ReservationTerms,
} from "@/features/reservations/domain/booking";
import {
  addDays,
  buildWeekDays,
  formatBookingOpening,
  formatTime,
  groupSlotsByLocalDate,
  startOfIsoWeek,
  toDateInputValue,
  type CalendarSlot,
  type ReservableResource,
} from "@/features/reservations/domain/calendar";
import { reservationBookingService } from "@/features/reservations/services/reservationBookingService";
import { reservationCalendarService } from "@/features/reservations/services/reservationCalendarService";
import { useAuth } from "@/shared/hooks/useAuth";
import "./ReservationsPage.css";
import "./ReservationLockedSlots.css";

const dayFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

const fullDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const rangeFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const emptyGuestContact: GuestContact = { name: "", email: "", phone: "" };

function CalendarSkeleton() {
  return (
    <div className="reservation-calendar__skeleton" aria-label="Chargement du calendrier">
      {Array.from({ length: 7 }, (_, index) => (
        <div className="reservation-calendar__skeleton-column" key={index} />
      ))}
    </div>
  );
}

function SlotCard({
  slot,
  timezone,
  onBook,
}: {
  slot: CalendarSlot;
  timezone: string;
  onBook: (slot: CalendarSlot) => void;
}) {
  const slotTime = formatTime(slot.startsAt, timezone);

  if (slot.status === "occupied") {
    return (
      <div
        className="reservation-slot reservation-slot--occupied"
        aria-label={`${slotTime} : occupé`}
      >
        <strong>{slotTime}</strong>
        <span>Occupé</span>
      </div>
    );
  }

  if (slot.status === "locked") {
    const openingLabel = slot.bookingOpensAt
      ? formatBookingOpening(slot.bookingOpensAt, timezone)
      : "prochainement";

    return (
      <div
        className="reservation-slot reservation-slot--locked"
        aria-label={`${slotTime} : réservable à partir du ${openingLabel}`}
      >
        <strong>{slotTime}</strong>
        <span>Réservable dès le {openingLabel}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="reservation-slot reservation-slot--available"
      aria-label={`Réserver le créneau de ${slotTime}`}
      onClick={() => onBook(slot)}
    >
      <strong>{slotTime}</strong>
      <span>Réserver</span>
    </button>
  );
}

function BookingModal({
  slot,
  resource,
  isAuthenticated,
  onClose,
  onSuccess,
}: {
  slot: CalendarSlot;
  resource: ReservableResource;
  isAuthenticated: boolean;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const [terms, setTerms] = useState<ReservationTerms | null>(null);
  const [guestContact, setGuestContact] = useState<GuestContact>(emptyGuestContact);
  const [formErrors, setFormErrors] = useState<BookingFormErrors>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);

  useEffect(() => {
    let isCurrent = true;

    void reservationBookingService
      .getTerms(slot.startsAt)
      .then((reservationTerms) => {
        if (isCurrent) setTerms(reservationTerms);
      })
      .catch((error: unknown) => {
        if (isCurrent) setErrorMessage(getBookingErrorMessage(error));
      });

    return () => {
      isCurrent = false;
    };
  }, [slot.startsAt]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    if (!isAuthenticated) {
      const errors = validateGuestContact(guestContact);
      setFormErrors(errors);
      if (Object.keys(errors).length > 0) return;
    }

    setIsSubmitting(true);

    try {
      await reservationBookingService.create(
        resource.id,
        slot.startsAt,
        isAuthenticated ? undefined : guestContact,
      );
      setIsConfirmed(true);
      await onSuccess();
    } catch (error) {
      setErrorMessage(getBookingErrorMessage(error));
      await onSuccess();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="booking-modal" role="presentation" onMouseDown={onClose}>
      <section
        className="booking-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="booking-modal__close"
          aria-label="Fermer"
          onClick={onClose}
        >
          ×
        </button>

        {isConfirmed ? (
          <div className="booking-modal__success" role="status">
            <span aria-hidden="true">✓</span>
            <h2 id="booking-modal-title">Réservation confirmée</h2>
            <p>
              Votre créneau au {resource.name} est enregistré pour le{" "}
              {fullDateFormatter.format(new Date(slot.startsAt))} à{" "}
              {formatTime(slot.startsAt, resource.timezone)}.
            </p>
            <button type="button" onClick={onClose}>
              Retour au calendrier
            </button>
          </div>
        ) : (
          <form onSubmit={(event) => void handleSubmit(event)}>
            <p className="booking-modal__eyebrow">Confirmation du créneau</p>
            <h2 id="booking-modal-title">Réserver {resource.name}</h2>

            <dl className="booking-modal__summary">
              <div>
                <dt>Date</dt>
                <dd>{fullDateFormatter.format(new Date(slot.startsAt))}</dd>
              </div>
              <div>
                <dt>Horaire</dt>
                <dd>
                  {formatTime(slot.startsAt, resource.timezone)} –{" "}
                  {formatTime(slot.endsAt, resource.timezone)}
                </dd>
              </div>
              <div>
                <dt>Tarif</dt>
                <dd>{terms ? formatPrice(terms.priceCents) : "Calcul en cours…"}</dd>
              </div>
            </dl>

            {terms && (
              <p className="booking-modal__terms">
                {terms.customerType === "licensee"
                  ? "Tarif licencié actif validé."
                  : "Tarif public applicable."}
              </p>
            )}

            {!isAuthenticated && (
              <fieldset className="booking-modal__fields">
                <legend>Vos coordonnées</legend>
                <label>
                  Nom complet
                  <input
                    value={guestContact.name}
                    onChange={(event) =>
                      setGuestContact((current) => ({ ...current, name: event.target.value }))
                    }
                    autoComplete="name"
                    aria-invalid={Boolean(formErrors.name)}
                  />
                  {formErrors.name && <small>{formErrors.name}</small>}
                </label>
                <label>
                  Adresse électronique
                  <input
                    type="email"
                    value={guestContact.email}
                    onChange={(event) =>
                      setGuestContact((current) => ({ ...current, email: event.target.value }))
                    }
                    autoComplete="email"
                    aria-invalid={Boolean(formErrors.email)}
                  />
                  {formErrors.email && <small>{formErrors.email}</small>}
                </label>
                <label>
                  Téléphone
                  <input
                    type="tel"
                    value={guestContact.phone}
                    onChange={(event) =>
                      setGuestContact((current) => ({ ...current, phone: event.target.value }))
                    }
                    autoComplete="tel"
                    aria-invalid={Boolean(formErrors.phone)}
                  />
                  {formErrors.phone && <small>{formErrors.phone}</small>}
                </label>
              </fieldset>
            )}

            {isAuthenticated && (
              <p className="booking-modal__account">
                La réservation sera rattachée à votre compte connecté.
              </p>
            )}

            {errorMessage && (
              <div className="booking-modal__error" role="alert">
                {errorMessage}
              </div>
            )}

            <div className="booking-modal__actions">
              <button type="button" className="booking-modal__secondary" onClick={onClose}>
                Annuler
              </button>
              <button type="submit" disabled={isSubmitting || !terms}>
                {isSubmitting
                  ? "Réservation en cours…"
                  : terms
                    ? `Confirmer à ${formatPrice(terms.priceCents)}`
                    : "Chargement…"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

export function ReservationsPage() {
  const { isAuthenticated } = useAuth();
  const [resources, setResources] = useState<ReservableResource[]>([]);
  const [resourceId, setResourceId] = useState("");
  const [anchorDate, setAnchorDate] = useState(() => startOfIsoWeek(new Date()));
  const [slots, setSlots] = useState<CalendarSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<CalendarSlot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedResource = resources.find((resource) => resource.id === resourceId);
  const weekDays = useMemo(() => buildWeekDays(anchorDate), [anchorDate]);
  const weekStart = weekDays[0];
  const weekEnd = weekDays[6];
  const weekStartValue = toDateInputValue(weekStart);
  const weekEndValue = toDateInputValue(weekEnd);
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

  async function loadSlots(): Promise<void> {
    if (!resourceId) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      setSlots(
        await reservationCalendarService.listSlots(
          resourceId,
          weekStartValue,
          weekEndValue,
        ),
      );
    } catch {
      setErrorMessage("Impossible de charger les disponibilités.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadSlots();
  }, [resourceId, weekEndValue, weekStartValue]);

  return (
    <section className="reservation-calendar">
      <div className="reservation-calendar__header">
        <div>
          <p className="reservation-calendar__eyebrow">Réservations du trinquet</p>
          <h1>Calendrier des disponibilités</h1>
          <p>Les créneaux s’ouvrent à 8 h, 48 h avant pour le public et 72 h avant pour les licenciés.</p>
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
                        onBook={setSelectedSlot}
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
        <span>
          <i className="reservation-calendar__dot reservation-calendar__dot--available" /> Libre
        </span>
        <span>
          <i className="reservation-calendar__dot reservation-calendar__dot--locked" /> Pas encore ouvert
        </span>
        <span>
          <i className="reservation-calendar__dot reservation-calendar__dot--occupied" /> Occupé
        </span>
        <span>
          <i className="reservation-calendar__dot reservation-calendar__dot--closed" /> Fermé
        </span>
      </div>

      {selectedSlot && selectedResource && (
        <BookingModal
          slot={selectedSlot}
          resource={selectedResource}
          isAuthenticated={isAuthenticated}
          onClose={() => setSelectedSlot(null)}
          onSuccess={loadSlots}
        />
      )}
    </section>
  );
}
