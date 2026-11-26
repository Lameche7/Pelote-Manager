import { useState, type FormEvent } from "react";
import { supabase } from "@/infrastructure/supabase/client";

export type TeamPayment = {
  team_id: string;
  status: string;
  amount_cents: number;
  received_cents: number;
  remaining_cents: number;
  can_record_manual: boolean;
  manual_methods: string[];
};

const labels: Record<string, string> = {
  paid: "Réglé",
  unpaid: "Non réglé",
  partial: "Partiel",
  processing: "En cours",
  free: "Gratuit",
  disputed: "En litige",
  expired: "Expiré",
  failed: "Non abouti",
  refunded: "Remboursé",
};

const methods: Record<string, string> = {
  cash: "Espèces",
  cheque: "Chèque",
  bank_transfer: "Virement",
};

const euros = (cents: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);

export function AdminTournamentPaymentCell({
  clubId,
  tournamentId,
  payment,
  disabled,
  onRecorded,
}: {
  clubId: string;
  tournamentId: string;
  payment: TeamPayment;
  disabled: boolean;
  onRecorded: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [method, setMethod] = useState("");
  const [amount, setAmount] = useState("");
  const [operationId, setOperationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);

  const allowed = payment.manual_methods.filter((key) => key in methods);
  const canRecord = payment.can_record_manual && allowed.length > 0;
  const open = () => {
    setMethod(allowed[0] ?? "");
    setAmount((payment.remaining_cents / 100).toFixed(2));
    setOperationId(crypto.randomUUID());
    setError("");
    setUncertain(false);
    setEditing(true);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || disabled || !canRecord || !allowed.includes(method)) return;
    const value = amount.trim().replace(",", ".");
    if (!/^\d+(\.\d{1,2})?$/.test(value)) {
      setError("Montant invalide.");
      return;
    }
    const cents = Math.round(Number(value) * 100);
    if (
      !Number.isSafeInteger(cents) ||
      cents <= 0 ||
      cents > payment.remaining_cents
    ) {
      setError("Le montant doit être inférieur ou égal au solde restant.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc(
        "admin_record_tournament_manual_receipt_for_club",
        {
          target_club_id: clubId,
          target_tournament_id: tournamentId,
          target_team_id: payment.team_id,
          payment_method: method,
          received_cents: cents,
          operation_id: operationId,
        },
      );
      if (error) throw error;
      setEditing(false);
      onRecorded();
    } catch {
      setUncertain(true);
      setError("Règlement non confirmé. Réessayez sans modifier la saisie.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <strong>{labels[payment.status] ?? "À vérifier"}</strong>
      <small>
        {euros(payment.received_cents)} / {euros(payment.amount_cents)}
      </small>
      {canRecord && !editing && (
        <button type="button" disabled={disabled} onClick={open}>
          Enregistrer un règlement
        </button>
      )}
      {editing && (
        <form onSubmit={submit}>
          <label>
            Moyen de paiement
            <select
              value={method}
              disabled={busy || uncertain}
              onChange={(event) => setMethod(event.target.value)}
            >
              {allowed.map((key) => (
                <option key={key} value={key}>
                  {methods[key]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Montant reçu (€)
            <input
              inputMode="decimal"
              required
              value={amount}
              disabled={busy || uncertain}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          {error && <small role="alert">{error}</small>}
          <button type="submit" disabled={busy || disabled || !canRecord}>
            {busy ? "Enregistrement…" : "Confirmer le règlement reçu"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setEditing(false);
              onRecorded();
            }}
          >
            Fermer et actualiser
          </button>
        </form>
      )}
    </div>
  );
}
