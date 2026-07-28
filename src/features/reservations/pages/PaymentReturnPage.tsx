import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  reservationPaymentService,
  type PaymentReturnStatus,
} from "@/features/reservations/services/reservationPaymentService";
import { ROUTES } from "@/shared/config";
import "./PaymentReturnPage.css";

const formatter = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

export function PaymentReturnPage() {
  const [searchParams] = useSearchParams();
  const paymentId = searchParams.get("paymentId");
  const result = searchParams.get("result");
  const [payment, setPayment] = useState<PaymentReturnStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!paymentId) {
      setError("Identifiant de paiement manquant.");
      setIsLoading(false);
      return;
    }

    let active = true;
    let attempts = 0;
    let timer: number | undefined;

    async function refresh() {
      try {
        const current = await reservationPaymentService.getReturnStatus(paymentId);
        if (!active) return;
        setPayment(current);
        setError(null);
        setIsLoading(false);

        if (["pending", "authorized"].includes(current.paymentStatus) && attempts < 10) {
          attempts += 1;
          timer = window.setTimeout(() => void refresh(), 2000);
        }
      } catch (loadError: unknown) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Vérification impossible.");
        setIsLoading(false);
      }
    }

    void refresh();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [paymentId]);

  const paid = payment?.paymentStatus === "paid";
  const pending = payment && ["pending", "authorized"].includes(payment.paymentStatus);

  return (
    <section className="payment-return" aria-labelledby="payment-return-title">
      {isLoading ? (
        <p>Vérification du paiement HelloAsso…</p>
      ) : error ? (
        <div className="payment-return__card payment-return__card--error">
          <h1 id="payment-return-title">Paiement non vérifiable</h1>
          <p>{error}</p>
          <Link to={ROUTES.reservations}>Retour aux réservations</Link>
        </div>
      ) : paid && payment ? (
        <div className="payment-return__card payment-return__card--success">
          <span aria-hidden="true">✓</span>
          <h1 id="payment-return-title">Paiement confirmé</h1>
          <p>
            Votre réservation au {payment.resourceName} est confirmée pour le{" "}
            {new Date(payment.startsAt).toLocaleString("fr-FR")}.
          </p>
          <strong>{formatter.format(payment.amountCents / 100)}</strong>
          <Link to={ROUTES.reservations}>Retour au calendrier</Link>
        </div>
      ) : pending && payment ? (
        <div className="payment-return__card">
          <h1 id="payment-return-title">Confirmation en cours</h1>
          <p>
            HelloAsso a renvoyé vers Pelote Manager. Nous attendons encore la confirmation serveur du
            paiement. Cette page s’actualise automatiquement.
          </p>
        </div>
      ) : (
        <div className="payment-return__card payment-return__card--error">
          <h1 id="payment-return-title">Paiement non finalisé</h1>
          <p>
            {result === "back"
              ? "Vous avez quitté le formulaire HelloAsso avant la confirmation."
              : "Le paiement a été annulé, refusé ou a expiré."}
          </p>
          <Link to={ROUTES.reservations}>Choisir un autre créneau</Link>
        </div>
      )}
    </section>
  );
}