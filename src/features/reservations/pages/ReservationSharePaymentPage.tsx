import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  reservationBookingService,
  type ReservationSharePayment,
} from "@/features/reservations/services/reservationBookingService";
import { ROUTES } from "@/shared/config";
import "./PaymentReturnPage.css";

const moneyFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
});

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

export function ReservationSharePaymentPage() {
  const [searchParams] = useSearchParams();
  const paymentId = searchParams.get("paymentId");
  const result = searchParams.get("result");
  const [payment, setPayment] = useState<ReservationSharePayment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPaying, setIsPaying] = useState(false);

  const refresh = useCallback(async () => {
    if (!paymentId) {
      setError("Identifiant de paiement manquant.");
      setIsLoading(false);
      return null;
    }

    try {
      const current = await reservationBookingService.getSharePayment(paymentId);
      setPayment(current);
      setError(null);
      setIsLoading(false);
      return current;
    } catch (loadError: unknown) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Impossible de charger cette part de paiement.",
      );
      setIsLoading(false);
      return null;
    }
  }, [paymentId]);

  useEffect(() => {
    let active = true;
    let attempts = 0;
    let timer: number | undefined;

    async function load() {
      const current = await refresh();
      if (!active || !current || !result) return;

      if (
        ["pending", "authorized"].includes(current.paymentStatus) &&
        attempts < 10
      ) {
        attempts += 1;
        timer = window.setTimeout(() => void load(), 2000);
      }
    }

    void load();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [refresh, result]);

  async function payShare() {
    if (!paymentId) return;
    setIsPaying(true);
    setError(null);
    try {
      await reservationBookingService.payAssignedShare(paymentId);
      await refresh();
    } catch (payError: unknown) {
      setError(
        payError instanceof Error
          ? payError.message
          : "Impossible de démarrer le paiement.",
      );
    } finally {
      setIsPaying(false);
    }
  }

  if (isLoading) {
    return (
      <section className="payment-return">
        <p>Chargement de votre part de paiement…</p>
      </section>
    );
  }

  if (error && !payment) {
    return (
      <section className="payment-return" aria-labelledby="share-payment-title">
        <div className="payment-return__card payment-return__card--error">
          <h1 id="share-payment-title">Paiement indisponible</h1>
          <p>{error}</p>
          <Link to={ROUTES.reservations}>Retour aux réservations</Link>
        </div>
      </section>
    );
  }

  if (!payment) return null;

  const paid = payment.paymentStatus === "paid";
  const confirmed = payment.reservationStatus === "confirmed";
  const expired =
    payment.paymentStatus === "expired" ||
    payment.reservationStatus === "expired" ||
    new Date(payment.expiresAt).getTime() <= Date.now();
  const canPay = !paid && !expired && payment.reservationStatus === "pending";

  return (
    <section className="payment-return" aria-labelledby="share-payment-title">
      <div
        className={`payment-return__card${
          paid ? " payment-return__card--success" : expired ? " payment-return__card--error" : ""
        }`}
      >
        {paid && <span aria-hidden="true">✓</span>}
        <h1 id="share-payment-title">
          {confirmed
            ? "Réservation entièrement payée"
            : paid
              ? "Votre part est réglée"
              : expired
                ? "Demande de paiement expirée"
                : "Payer ma part"}
        </h1>

        <p>
          Réservation de {payment.resourceName} par {payment.bookerName}, le{" "}
          {dateFormatter.format(new Date(payment.startsAt))}.
        </p>

        <strong>{moneyFormatter.format(payment.amountCents / 100)}</strong>

        <p>
          Paiements reçus : {payment.paidCount}/{payment.paymentCount}.
          {paid && !confirmed
            ? " Le créneau reste réservé pendant que les autres joueurs règlent leur part."
            : ""}
        </p>

        {result === "back" && !paid && !expired && (
          <p>Vous avez quitté HelloAsso avant la confirmation. Vous pouvez réessayer.</p>
        )}

        {result === "error" && !paid && !expired && (
          <p>Le paiement HelloAsso n’a pas abouti. Vous pouvez relancer votre paiement.</p>
        )}

        {error && <p role="alert">{error}</p>}

        {canPay && (
          <button type="button" disabled={isPaying} onClick={() => void payShare()}>
            {isPaying
              ? "Ouverture du paiement…"
              : payment.paymentStatus === "failed" ||
                  payment.paymentStatus === "cancelled"
                ? `Réessayer — ${moneyFormatter.format(payment.amountCents / 100)}`
                : `Payer ma part — ${moneyFormatter.format(payment.amountCents / 100)}`}
          </button>
        )}

        <Link to={ROUTES.myReservations}>Voir mes réservations</Link>
      </div>
    </section>
  );
}
