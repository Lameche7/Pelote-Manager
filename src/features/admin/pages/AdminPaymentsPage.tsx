import { useCallback, useEffect, useState } from "react";
import {
  adminPaymentService,
  type AdminPayment,
} from "@/features/admin/services/adminPaymentService";
import type { PaymentStatus } from "@/features/reservations/services/reservationPaymentService";
import "./AdminPaymentsPage.css";

const STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "En attente",
  authorized: "Autorisé",
  paid: "Payé",
  failed: "Échoué",
  cancelled: "Annulé",
  refunded: "Remboursé",
  expired: "Expiré",
};

function dateInput(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function euros(cents: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
}

export function AdminPaymentsPage() {
  const [status, setStatus] = useState<PaymentStatus | "all">("all");
  const [from, setFrom] = useState(dateInput(-30));
  const [to, setTo] = useState(dateInput(60));
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setPayments(await adminPaymentService.list({ status, from, to }));
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
    } finally {
      setIsLoading(false);
    }
  }, [from, status, to]);

  useEffect(() => {
    void load();
  }, [load]);

  async function expireAbandoned() {
    try {
      const count = await adminPaymentService.expireAbandoned();
      setMessage(`${count} paiement(s) abandonné(s) ont été expirés.`);
      await load();
    } catch (expireError: unknown) {
      setError(expireError instanceof Error ? expireError.message : "Expiration impossible.");
    }
  }

  async function cancelReservation(payment: AdminPayment) {
    if (!window.confirm("Annuler cette réservation et libérer le créneau ?")) return;
    setBusyId(payment.id);
    setError(null);
    setMessage(null);
    try {
      const refundRequired = await adminPaymentService.cancelReservation(payment.id);
      setMessage(
        refundRequired
          ? "Réservation annulée. Un paiement encaissé reste à rembourser."
          : "Réservation annulée et créneau libéré.",
      );
      await load();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Annulation impossible.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteTest(payment: AdminPayment) {
    if (!window.confirm("Supprimer définitivement cette réservation et ses paiements de test ?")) return;
    setBusyId(payment.id);
    setError(null);
    setMessage(null);
    try {
      await adminPaymentService.deleteTest(payment.id);
      setMessage("Paiement test et réservation supprimés.");
      await load();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Suppression impossible.");
    } finally {
      setBusyId(null);
    }
  }

  const collected = payments
    .filter((payment) => payment.status === "paid")
    .reduce((sum, payment) => sum + payment.amountCents, 0);

  return (
    <section className="admin-payments" aria-labelledby="admin-payments-title">
      <header>
        <p className="admin-payments__eyebrow">HelloAsso</p>
        <h1 id="admin-payments-title">Suivi des paiements</h1>
        <p>Contrôlez les encaissements, les abandons et les identifiants HelloAsso.</p>
      </header>

      {error && <p className="admin-payments__alert admin-payments__alert--error" role="alert">{error}</p>}
      {message && <p className="admin-payments__alert" role="status">{message}</p>}

      <div className="admin-payments__summary">
        <article><span>Paiements affichés</span><strong>{payments.length}</strong></article>
        <article><span>Montant encaissé</span><strong>{euros(collected)}</strong></article>
      </div>

      <div className="admin-payments__filters">
        <label>
          Statut
          <select value={status} onChange={(event) => setStatus(event.target.value as PaymentStatus | "all")}>
            <option value="all">Tous</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>Du<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>Au<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <button type="button" onClick={() => void expireAbandoned()}>Expirer les abandons</button>
      </div>

      {isLoading ? <p>Chargement…</p> : (
        <div className="admin-payments__table-wrap">
          <table>
            <thead>
              <tr><th>Client</th><th>Réservation</th><th>Montant</th><th>Statut</th><th>HelloAsso</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <td><strong>{payment.customerName}</strong><small>{payment.customerEmail}</small></td>
                  <td>{payment.resourceName}<small>{new Date(payment.startsAt).toLocaleString("fr-FR")}</small><small>Réservation : {payment.reservationStatus}</small></td>
                  <td>{euros(payment.amountCents)}</td>
                  <td><span className={`admin-payments__status admin-payments__status--${payment.status}`}>{STATUS_LABELS[payment.status]}</span>{payment.failureReason && <small>{payment.failureReason}</small>}</td>
                  <td><small>Checkout : {payment.checkoutIntentId ?? "—"}</small><small>Commande : {payment.orderId ?? "—"}</small><small>Paiement : {payment.providerPaymentId ?? "—"}</small></td>
                  <td>
                    <div className="admin-payments__actions">
                      {payment.canCancelReservation && (
                        <button type="button" onClick={() => void cancelReservation(payment)} disabled={busyId === payment.id}>
                          Annuler la réservation
                        </button>
                      )}
                      {payment.canDeleteTest && (
                        <button type="button" className="is-danger" onClick={() => void deleteTest(payment)} disabled={busyId === payment.id}>
                          Supprimer le test
                        </button>
                      )}
                      {!payment.canCancelReservation && !payment.canDeleteTest && <small>Aucune action</small>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {payments.length === 0 && <p>Aucun paiement pour cette période.</p>}
        </div>
      )}
    </section>
  );
}