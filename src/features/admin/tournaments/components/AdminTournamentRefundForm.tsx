import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/infrastructure/supabase/client";

type PendingRefund = {
  operation_id: string;
  amount_cents: number;
  reason: string;
  status: string;
};
type Source = {
  id: string;
  method: string;
  amount_cents: number;
  refundable_cents: number;
  refunded_cents: number;
  pending_cents: number;
  pending_requests: PendingRefund[];
};
const labels: Record<string, string> = {
  stripe: "Stripe",
  cash: "Espèces",
  cheque: "Chèque",
  bank_transfer: "Virement",
};
const euros = (cents: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);

export function AdminTournamentRefundForm({
  clubId,
  tournamentId,
  teamId,
  disabled,
  onClose,
  onRecorded,
}: {
  clubId: string;
  tournamentId: string;
  teamId: string;
  disabled: boolean;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [operationId, setOperationId] = useState<string>(() => crypto.randomUUID());
  const [retry, setRetry] = useState<PendingRefund | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const source = sources?.find((item) => item.id === sourceId);

  useEffect(() => {
    let active = true;
    void supabase
      .rpc("admin_list_tournament_refund_sources_for_club", {
        target_club_id: clubId,
        target_tournament_id: tournamentId,
        target_team_id: teamId,
      })
      .then(({ data, error }) => {
        if (!active) return;
        if (error || !Array.isArray(data)) {
          setError("Impossible de charger les règlements d’origine.");
          return;
        }
        setSources(data as Source[]);
      });
    return () => {
      active = false;
    };
  }, [clubId, tournamentId, teamId]);

  const choose = (item: Source, pending: PendingRefund | null = null) => {
    setSourceId(item.id);
    setRetry(pending);
    setAmount(((pending?.amount_cents ?? item.refundable_cents) / 100).toFixed(2));
    setReason(pending?.reason ?? "");
    setOperationId(pending?.operation_id ?? crypto.randomUUID());
    setConfirmed(false);
    setError("");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!source || busy || disabled || !confirmed) return;
    const value = amount.trim().replace(",", ".");
    const cents = Math.round(Number(value) * 100);
    if (
      !/^\d+(\.\d{1,2})?$/.test(value) ||
      !Number.isSafeInteger(cents) ||
      cents <= 0 ||
      cents > (retry?.amount_cents ?? source.refundable_cents) ||
      !reason.trim() ||
      reason.trim().length > 500
    ) {
      setError("Montant ou motif invalide.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (source.method === "stripe") {
        const { data, error } = await supabase.functions.invoke(
          "create-tournament-stripe-refund",
          {
            body: {
              clubId,
              tournamentId,
              teamId,
              attemptId: source.id,
              operationId,
              amountCents: cents,
              reason: reason.trim(),
            },
          },
        );
        if (error || !["succeeded", "pending", "failed", "cancelled"].includes(data?.status))
          throw new Error("Unconfirmed refund");
      } else {
        const { error } = await supabase.rpc(
          "admin_record_tournament_manual_refund_for_club",
          {
            target_club_id: clubId,
            target_tournament_id: tournamentId,
            target_team_id: teamId,
            target_receipt_id: source.id,
            refund_cents: cents,
            refund_reason: reason.trim(),
            operation_id: operationId,
          },
        );
        if (error) throw error;
      }
      onRecorded();
    } catch {
      setUncertain(true);
      setError("Remboursement non confirmé. Ne créez pas de nouvelle demande. Réessayez avec les mêmes informations.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <strong>Rembourser un règlement</strong>
      {!sources && !error && <small role="status">Chargement…</small>}
      {sources?.map((item) => (
        <div key={item.id}>
          <small>
            {labels[item.method] ?? item.method} : {euros(item.amount_cents)} ·{" "}
            {euros(item.refundable_cents)} remboursables
          </small>
          {item.refundable_cents > 0 && (
            <button type="button" disabled={busy || uncertain || disabled} onClick={() => choose(item)}>
              Choisir ce règlement
            </button>
          )}
          {item.pending_requests.map((pending) => (
            <button key={pending.operation_id} type="button" disabled={busy || uncertain || disabled} onClick={() => choose(item, pending)}>
              Vérifier / reprendre {euros(pending.amount_cents)}
            </button>
          ))}
        </div>
      ))}
      {source && (
        <>
          <label>
            Montant à rembourser (€)
            <input required inputMode="decimal" value={amount} disabled={busy || uncertain || !!retry} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <label>
            Motif
            <textarea required maxLength={500} value={reason} disabled={busy || uncertain || !!retry} onChange={(event) => setReason(event.target.value)} />
          </label>
          <label>
            <input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />
            {source.method === "stripe"
              ? "Je confirme la demande de remboursement Stripe."
              : "Je confirme avoir réellement remboursé cette somme hors Pilotoki."}
          </label>
          <small>Cette action ne retire pas l’équipe du tournoi.</small>
          <button type="submit" disabled={busy || disabled || !confirmed}>
            {busy ? "Traitement…" : "Confirmer le remboursement"}
          </button>
        </>
      )}
      {error && <small role="alert">{error}</small>}
      <button type="button" disabled={busy || uncertain} onClick={onClose}>
        Fermer
      </button>
    </form>
  );
}
