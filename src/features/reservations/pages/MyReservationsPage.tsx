import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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

function ReservationCard({
  reservation,
  busyId,
  onCancel,
  onResumePayment,
}: {
  reservation: MyReservation;
  busyId: string | null;
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
  const [reservations, setReservations] = useState<MyReservation[]>([]);
  const [view, setView] = useState<"upcoming" | "history">("upcoming");
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingCancellation, setPendingCancellation] = useState<MyReservation | null>(null);

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

  const displayed = useMemo(
    () =>
      reservations.filter((reservation) =>
        view === "upcoming" ? isUpcoming(reservation) : !isUpcoming(reservation),
      ),
    [reservations, view],
  );

  async function cancelReservation(reservation: MyReservation) {
    setBusyId(reservation.id);
    setError(null);
    setMessage(null);
    try {
      const result = await myReservationsService.cancel(reservation.id);
      setMessage(
        result.refundRequired
          ? "La réservation est annulée. Le remboursement devra être traité selon la politique du club."
          : "La réservation est annulée, le créneau est libre et les licenciés ont été notifiés.",
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
                onCancel={async (reservation) => setPendingCancellation(reservation)}
                onResumePayment={resumePayment}
              />
            ))}
          </div>
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
