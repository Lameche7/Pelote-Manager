import { useEffect, useState } from "react";
import { supabase } from "@/infrastructure/supabase/client";

type PaymentSummary = {
  status: string;
  amount_cents: number;
  received_cents: number;
  refunded_cents: number;
  refund_pending_cents: number;
  remaining_cents: number;
  can_pay: boolean;
  manual_methods: string[];
};

const manualLabels: Record<string, string> = {
  cash: "Espèces",
  cheque: "Chèque",
  bank_transfer: "Virement",
};

const labels: Record<string, string> = {
  unpaid: "À régler",
  creating: "À régler",
  open: "À régler",
  processing: "En attente de confirmation Stripe",
  paid: "Paiement confirmé",
  expired: "Session expirée",
  failed: "Paiement non abouti",
  refunded: "Remboursé",
  partially_refunded: "Partiellement remboursé",
  refund_pending: "Remboursement en cours",
  disputed: "Paiement en litige",
};

export function TournamentStripePayment({
  teamId,
  onPaymentConfirmed,
}: {
  teamId: string;
  onPaymentConfirmed?: () => Promise<void>;
}) {
  const [payment, setPayment] = useState<PaymentSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void supabase
      .rpc("get_my_tournament_stripe_payment", {
        target_team_id: teamId,
      })
      .then(({ data, error }) => {
        if (!active) return;
        setLoading(false);
        if (error) {
          setError("Impossible de vérifier le règlement. Réessayez.");
          return;
        }
        if (!data) {
          setPayment(null);
          return;
        }
        const summary = data as PaymentSummary;
        if (
          typeof summary.status === "string" &&
          Number.isSafeInteger(summary.amount_cents) &&
          summary.amount_cents > 0 &&
          Number.isSafeInteger(summary.received_cents) &&
          Number.isSafeInteger(summary.refunded_cents) &&
          Number.isSafeInteger(summary.refund_pending_cents) &&
          Number.isSafeInteger(summary.remaining_cents) &&
          summary.remaining_cents >= 0 &&
          Array.isArray(summary.manual_methods) &&
          typeof summary.can_pay === "boolean"
        )
          setPayment(summary);
      });
    return () => {
      active = false;
    };
  }, [teamId, refresh]);

  useEffect(() => {
    if (payment?.status !== "paid") return;
    void onPaymentConfirmed?.().catch(() => undefined);
  }, [payment?.status, onPaymentConfirmed]);

  const checkout = async () => {
    if (!payment?.can_pay || busy) return;
    setBusy(true);
    setError("");
    try {
      const { data, error } = await supabase.functions.invoke(
        "create-tournament-stripe-checkout",
        { body: { teamId } },
      );
      if (error) throw error;
      if (data?.status === "open" && typeof data.redirectUrl === "string") {
        const url = new URL(data.redirectUrl);
        if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com")
          throw new Error("Lien de paiement invalide.");
        window.location.assign(url.href);
        return;
      }
      setRefresh((value) => value + 1);
    } catch {
      setError(
        "Impossible d’ouvrir le paiement. Votre inscription reste enregistrée.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!payment) {
    if (!loading && !error) return null;
    return (
      <section className="public-tournament-panel" aria-label="Règlement">
        {loading && <p role="status">Vérification du règlement…</p>}
        {error && <p role="alert">{error}</p>}
        {error && (
          <button
            type="button"
            onClick={() => setRefresh((value) => value + 1)}
          >
            Réessayer
          </button>
        )}
      </section>
    );
  }
  const euros = (cents: number) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
    }).format(cents / 100);
  return (
    <section className="public-tournament-panel" aria-label="Règlement">
      <h3>Règlement de votre inscription</h3>
      <p>
        {euros(payment.amount_cents)}
        {" · "}
        {labels[payment.status] ?? "Vérification nécessaire"}
      </p>
      <p>
        Déjà réglé : {euros(payment.received_cents)} · Reste à régler :{" "}
        {euros(payment.remaining_cents)}
      </p>
      {payment.refunded_cents > 0 && (
        <p>Remboursé : {euros(payment.refunded_cents)}</p>
      )}
      {payment.refund_pending_cents > 0 && (
        <p>Remboursement en cours : {euros(payment.refund_pending_cents)}</p>
      )}
      {error && <p role="alert">{error}</p>}
      {payment.status === "processing" && (
        <p role="status">Ne relancez pas le paiement avant sa confirmation.</p>
      )}
      {payment.remaining_cents > 0 && payment.manual_methods.length > 0 && (
        <p>
          Autres moyens de paiement autorisés par le club :{" "}
          {payment.manual_methods
            .filter((method) => method in manualLabels)
            .map((method) => manualLabels[method])
            .join(", ")}
          . Contactez le club pour les modalités de règlement.
        </p>
      )}
      {payment.can_pay && (
        <button
          type="button"
          className="button button--primary"
          disabled={busy || loading}
          onClick={() => void checkout()}
        >
          {busy
            ? "Ouverture du paiement…"
            : `Régler ${euros(payment.remaining_cents)}`}
        </button>
      )}
      <button
        type="button"
        className="button button--ghost"
        disabled={busy || loading}
        onClick={() => setRefresh((value) => value + 1)}
      >
        Actualiser le règlement
      </button>
    </section>
  );
}
