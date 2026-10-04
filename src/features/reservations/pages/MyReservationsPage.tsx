import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  CalendarSlot,
  ReservableResource,
} from "@/features/reservations/domain/calendar";
import { formatTime } from "@/features/reservations/domain/calendar";
import { reservationCalendarService } from "@/features/reservations/services/reservationCalendarService";
import {
  myReservationsService,
  type MyReservation,
  type PaymentStatus,
  type ReservationStatus,
} from "@/features/reservations/services/myReservationsService";
import { ROUTES } from "@/shared/config";
import { UserSpaceShell } from "@/features/user-space/components/UserSpaceShell";
import "./MyReservationsPage.css";

const reservationLabels: Record<ReservationStatus, string> = {
  draft: "Brouillon",
  pending: "En attente",
  confirmed: "Confirmée",
  completed: "Terminée",
  cancelled: "Annulée",
  refused: "Refusée",
  expired: "Expirée",
  no_show: "Absence",
};

const paymentLabels: Record<PaymentStatus, string> = {
  pending: "Paiement en attente",
  authorized: "Paiement autorisé",
  paid: "Payé",
  failed: "Paiement échoué",
  cancelled: "Paiement annulé",
  refunded: "Remboursé",
  expired: "Paiement expiré",
};

const money = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const dateTime = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const reservationDate = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const reservationTime = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
});

function isUpcoming(reservation: MyReservation) {
  return new Date(reservation.endsAt).getTime() >= Date.now();
}

function localDateValue(iso: string, timezone = "Europe/Paris") {
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function ReservationModificationDialog({
  reservation,
  onClose,
  onSaved,
}: {
  reservation: MyReservation;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [resources, setResources] = useState<ReservableResource[]>([]);
  const [resourceId, setResourceId] = useState(reservation.resourceId);
  const [date, setDate] = useState(localDateValue(reservation.startsAt));
  const [slots, setSlots] = useState<CalendarSlot[]>([]);
  const [selectedStartsAt, setSelectedStartsAt] = useState(reservation.startsAt);
  const [loadingResources, setLoadingResources] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    reservationCalendarService
      .listResources()
      .then((items) => {
        if (!active) return;
        setResources(items.filter((resource) => resource.clubId === reservation.clubId));
      })
      .catch((cause) => {
        if (!active) return;
        setError(
          cause instanceof Error ? cause.message : "Impossible de charger les terrains.",
        );
      })
      .finally(() => {
        if (active) setLoadingResources(false);
      });
    return () => {
      active = false;
    };
  }, [reservation.clubId]);

  const selectedResource = useMemo(
    () => resources.find((resource) => resource.id === resourceId) ?? null,
    [resources, resourceId],
  );

  useEffect(() => {
    if (!resourceId || !date) return;
    let active = true;
    setLoadingSlots(true);
    setError("");
    reservationCalendarService
      .listSlots(resourceId, date, date)
      .then((items) => {
        if (!active) return;
        setSlots(items);
      })
      .catch((cause) => {
        if (!active) return;
        setError(
          cause instanceof Error ? cause.message : "Impossible de charger les créneaux.",
        );
        setSlots([]);
      })
      .finally(() => {
        if (active) setLoadingSlots(false);
      });
    return () => {
      active = false;
    };
  }, [date, resourceId]);

  const timezone = selectedResource?.timezone ?? "Europe/Paris";
  const currentStart = new Date(reservation.startsAt).getTime();
  const selectableSlots = useMemo(
    () =>
      slots
        .filter((slot) => {
          const slotStart = new Date(slot.startsAt).getTime();
          const isCurrent =
            slot.resourceId === reservation.resourceId &&
            Math.abs(slotStart - currentStart) < 60_000;
          return isCurrent || slot.status === "available";
        })
        .sort(
          (left, right) =>
            new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime(),
        ),
    [currentStart, reservation.resourceId, slots],
  );

  useEffect(() => {
    if (loadingSlots) return;
    if (!selectableSlots.some((slot) => slot.startsAt === selectedStartsAt)) {
      setSelectedStartsAt("");
    }
  }, [loadingSlots, selectableSlots, selectedStartsAt]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedStartsAt) {
      setError("Choisissez un créneau disponible.");
      return;
    }
    if (
      resourceId === reservation.resourceId &&
      new Date(selectedStartsAt).getTime() === new Date(reservation.startsAt).getTime()
    ) {
      onClose();
      return;
    }

    setSaving(true);
    setError("");
    try {
      await myReservationsService.modify(reservation.id, resourceId, selectedStartsAt);
      await onSaved();
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Modification impossible.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="reservation-edit-dialog" role="presentation" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="reservation-edit-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className="my-reservations__eyebrow">Modifier la réservation</p>
        <h2 id="reservation-edit-title">
          Choisir un nouveau terrain ou un nouveau créneau
        </h2>
        <p className="reservation-edit-dialog__current">
          Actuellement : <strong>{reservation.resourceName}</strong> ·{" "}
          {dateTime.format(new Date(reservation.startsAt))}
        </p>

        <form onSubmit={save}>
          <div className="reservation-edit-dialog__fields">
            <label>
              <span>Terrain</span>
              <select
                value={resourceId}
                disabled={loadingResources || saving}
                onChange={(event) => {
                  setResourceId(event.target.value);
                  setSelectedStartsAt("");
                }}
              >
                {resources.length === 0 && (
                  <option value={reservation.resourceId}>{reservation.resourceName}</option>
                )}
                {resources.map((resource) => (
                  <option key={resource.id} value={resource.id}>
                    {resource.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Date</span>
              <input
                type="date"
                value={date}
                disabled={saving}
                onChange={(event) => {
                  setDate(event.target.value);
                  setSelectedStartsAt("");
                }}
              />
            </label>
          </div>

          <div className="reservation-edit-dialog__slots">
            <strong>Créneaux disponibles</strong>
            {loadingSlots ? (
              <p>Chargement…</p>
            ) : selectableSlots.length === 0 ? (
              <p>Aucun créneau disponible ce jour-là.</p>
            ) : (
              <div>
                {selectableSlots.map((slot) => {
                  const isCurrent =
                    slot.resourceId === reservation.resourceId &&
                    Math.abs(
                      new Date(slot.startsAt).getTime() -
                        new Date(reservation.startsAt).getTime(),
                    ) < 60_000;
                  return (
                    <button
                      type="button"
                      key={`${slot.resourceId}-${slot.startsAt}`}
                      className={selectedStartsAt === slot.startsAt ? "is-selected" : undefined}
                      onClick={() => setSelectedStartsAt(slot.startsAt)}
                    >
                      {formatTime(slot.startsAt, timezone)}
                      {isCurrent && <small>Actuel</small>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {error && (
            <p className="my-reservations__alert my-reservations__alert--error" role="alert">
              {error}
            </p>
          )}

          <footer>
            <button type="button" onClick={onClose} disabled={saving}>
              Annuler
            </button>
            <button type="submit" disabled={saving || !selectedStartsAt}>
              {saving ? "Modification…" : "Modifier la réservation"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function ReservationCard({
  reservation,
  busyId,
  onModify,
  onCancel,
  onResumePayment,
}: {
  reservation: MyReservation;
  busyId: string | null;
  onModify: (reservation: MyReservation) => void;
  onCancel: (reservation: MyReservation) => Promise<void>;
  onResumePayment: (reservation: MyReservation) => Promise<void>;
}) {
  const paymentCanResume =
    reservation.paymentRequired &&
    ["pending", "authorized"].includes(reservation.paymentStatus) &&
    Boolean(reservation.paymentId) &&
    (!reservation.paymentExpiresAt ||
      new Date(reservation.paymentExpiresAt).getTime() > Date.now());

  return (
    <article className="my-reservations__card">
      <div className="my-reservations__card-header">
        <div>
          <p className="my-reservations__resource">Réservation</p>
          <h2>{reservation.resourceName}</h2>
        </div>
        <strong>{money.format(reservation.amountCents / 100)}</strong>
      </div>

      <div className="my-reservations__badges">
        <span
          className={`my-reservations__badge my-reservations__badge--${reservation.reservationStatus}`}
        >
          {reservationLabels[reservation.reservationStatus]}
        </span>
        {reservation.paymentRequired && (
          <span
            className={`my-reservations__badge my-reservations__badge--payment-${reservation.paymentStatus}`}
          >
            {paymentLabels[reservation.paymentStatus]}
          </span>
        )}
      </div>

      <dl className="my-reservations__details">
        <div>
          <dt>Date</dt>
          <dd>{reservationDate.format(new Date(reservation.startsAt))}</dd>
        </div>
        <div>
          <dt>Heure</dt>
          <dd>{reservationTime.format(new Date(reservation.startsAt))}</dd>
        </div>
        <div>
          <dt>Terrain</dt>
          <dd>{reservation.resourceName}</dd>
        </div>
        <div>
          <dt>Tarif</dt>
          <dd>{money.format(reservation.amountCents / 100)}</dd>
        </div>
        <div>
          <dt>Statut</dt>
          <dd>{reservationLabels[reservation.reservationStatus]}</dd>
        </div>
        <div>
          <dt>Fin du créneau</dt>
          <dd>
            {new Date(reservation.endsAt).toLocaleTimeString("fr-FR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </dd>
        </div>
        <div>
          <dt>Annulation possible jusqu’au</dt>
          <dd>{dateTime.format(new Date(reservation.cancellationDeadline))}</dd>
        </div>
      </dl>

      {reservation.paymentRequired &&
        reservation.paymentStatus === "paid" &&
        reservation.reservationStatus === "cancelled" && (
          <p className="my-reservations__notice">
            La réservation est annulée. Le remboursement sera traité selon la politique du club.
          </p>
        )}

      <div className="my-reservations__actions">
        {reservation.canModify && (
          <button
            type="button"
            onClick={() => onModify(reservation)}
            disabled={busyId === reservation.id}
          >
            Modifier la réservation
          </button>
        )}
        {paymentCanResume && (
          <button
            type="button"
            onClick={() => void onResumePayment(reservation)}
            disabled={busyId === reservation.id}
          >
            Reprendre le paiement
          </button>
        )}
        {reservation.canCancel && (
          <button
            type="button"
            className="my-reservations__danger"
            onClick={() => void onCancel(reservation)}
            disabled={busyId === reservation.id}
          >
            Annuler la réservation
          </button>
        )}
      </div>
    </article>
  );
}

export function MyReservationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [reservations, setReservations] = useState<MyReservation[]>([]);
  const [view, setView] = useState<"upcoming" | "history">("upcoming");
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingCancellation, setPendingCancellation] = useState<MyReservation | null>(null);
  const [editingReservation, setEditingReservation] = useState<MyReservation | null>(null);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      setReservations(await myReservationsService.list());
    } catch (loadError: unknown) {
      setError(
        loadError instanceof Error ? loadError.message : "Chargement impossible.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (isLoading || editingReservation) return;
    const requestedId = searchParams.get("edit");
    if (!requestedId) return;
    const reservation = reservations.find((item) => item.id === requestedId);
    if (!reservation) return;
    if (!reservation.canModify) {
      setError("Cette réservation ne peut plus être modifiée.");
      return;
    }
    setEditingReservation(reservation);
  }, [editingReservation, isLoading, reservations, searchParams]);

  const displayed = useMemo(
    () =>
      reservations.filter((reservation) =>
        view === "upcoming" ? isUpcoming(reservation) : !isUpcoming(reservation),
      ),
    [reservations, view],
  );

  function closeModification() {
    setEditingReservation(null);
    if (searchParams.has("edit")) {
      const next = new URLSearchParams(searchParams);
      next.delete("edit");
      setSearchParams(next, { replace: true });
    }
  }

  async function modifiedReservation() {
    setMessage("La réservation a été modifiée.");
    await load();
  }

  async function cancelReservation(reservation: MyReservation) {
    setBusyId(reservation.id);
    setError(null);
    setMessage(null);
    try {
      const result = await myReservationsService.cancel(reservation.id);
      setMessage(
        result.refundRequired
          ? "La réservation est annulée. Le remboursement devra être traité selon la politique du club."
          : "La réservation est annulée et le créneau est de nouveau disponible.",
      );
      await load();
    } catch (cancelError: unknown) {
      setError(
        cancelError instanceof Error ? cancelError.message : "Annulation impossible.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function resumePayment(reservation: MyReservation) {
    setBusyId(reservation.id);
    setError(null);
    try {
      window.location.assign(await myReservationsService.resumePayment(reservation));
    } catch (paymentError: unknown) {
      setError(
        paymentError instanceof Error ? paymentError.message : "Paiement indisponible.",
      );
      setBusyId(null);
    }
  }

  return (
    <UserSpaceShell>
      <section className="my-reservations" aria-labelledby="my-reservations-title">
        <header>
          <p className="my-reservations__eyebrow">Espace personnel</p>
          <h1 id="my-reservations-title">Mes réservations</h1>
          <p>Consultez vos créneaux et les actions encore disponibles.</p>
        </header>

        {error && (
          <p className="my-reservations__alert my-reservations__alert--error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="my-reservations__alert" role="status">
            {message}
          </p>
        )}

        <div className="my-reservations__tabs" role="tablist" aria-label="Période des réservations">
          <button
            type="button"
            role="tab"
            aria-selected={view === "upcoming"}
            onClick={() => setView("upcoming")}
          >
            À venir
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "history"}
            onClick={() => setView("history")}
          >
            Historique
          </button>
        </div>

        {isLoading ? (
          <p>Chargement de vos réservations…</p>
        ) : displayed.length === 0 ? (
          <div className="my-reservations__empty">
            <h2>
              {view === "upcoming"
                ? "Aucune réservation à venir"
                : "Aucune réservation passée"}
            </h2>
            {view === "upcoming" && <Link to={ROUTES.reservations}>Réserver un créneau</Link>}
          </div>
        ) : (
          <div className="my-reservations__grid">
            {displayed.map((reservation) => (
              <ReservationCard
                key={reservation.id}
                reservation={reservation}
                busyId={busyId}
                onModify={setEditingReservation}
                onCancel={async (reservation) => setPendingCancellation(reservation)}
                onResumePayment={resumePayment}
              />
            ))}
          </div>
        )}

        {editingReservation && (
          <ReservationModificationDialog
            reservation={editingReservation}
            onClose={closeModification}
            onSaved={modifiedReservation}
          />
        )}

        {pendingCancellation && (
          <div
            className="cancellation-dialog"
            role="presentation"
            onMouseDown={() => setPendingCancellation(null)}
          >
            <section
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="cancellation-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <p className="my-reservations__eyebrow">Annulation</p>
              <h2 id="cancellation-title">Voulez-vous vraiment annuler cette réservation ?</h2>
              <p>
                {pendingCancellation.resourceName} ·{" "}
                {dateTime.format(new Date(pendingCancellation.startsAt))}
              </p>
              <p>Le créneau redeviendra disponible et les licenciés du club seront notifiés.</p>
              <div>
                <button type="button" onClick={() => setPendingCancellation(null)}>Retour</button>
                <button
                  type="button"
                  className="my-reservations__danger"
                  onClick={() => {
                    const reservation = pendingCancellation;
                    setPendingCancellation(null);
                    void cancelReservation(reservation);
                  }}
                >
                  Confirmer
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    </UserSpaceShell>
  );
}
