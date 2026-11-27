import { useEffect, useState } from "react";
import { supabase } from "@/infrastructure/supabase/client";

const statusLabels: Record<string, string> = {
  creating: "Préparation du test",
  open: "Paiement fictif en attente",
  processing: "Confirmation Stripe en cours",
  paid: "Paiement fictif confirmé par Stripe",
  expired: "Session de test expirée",
};

export function TournamentStripeDiagnostic({ clubId }: { clubId: string }) {
  const [allowed, setAllowed] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setAllowed(false);
    setStatus("");
    void supabase
      .rpc("get_my_tournament_stripe_diagnostic", {
        target_club_id: clubId,
      })
      .then(({ data, error }) => {
        if (!active || error) return;
        setAllowed(true);
        setStatus(typeof data?.status === "string" ? data.status : "");
      });
    return () => {
      active = false;
    };
  }, [clubId, revision]);

  const start = async () => {
    if (!allowed || busy) return;
    setBusy(true);
    setError("");
    try {
      const { data, error } = await supabase.functions.invoke(
        "create-tournament-stripe-diagnostic",
        { body: { clubId } },
      );
      if (error) throw error;
      if (data?.status === "processing") {
        setRevision((value) => value + 1);
        return;
      }
      if (data?.status !== "open" || typeof data.redirectUrl !== "string")
        throw new Error("Session indisponible");
      const destination = new URL(data.redirectUrl);
      if (
        destination.protocol !== "https:" ||
        destination.hostname !== "checkout.stripe.com"
      )
        throw new Error("Destination invalide");
      sessionStorage.setItem(
        "pilotoki-stripe-diagnostic-return",
        window.location.pathname + window.location.search,
      );
      window.location.assign(destination.href);
    } catch {
      setError("Impossible d’ouvrir le paiement fictif. Actualisez son état.");
    } finally {
      setBusy(false);
    }
  };

  if (!allowed) return null;
  return (
    <section aria-label="Diagnostic Stripe">
      <h3>Paiement de test privé</h3>
      <p>
        Montant fictif : 1,00 €. Aucun encaissement réel, aucune inscription
        créée.
      </p>
      <p role="status">
        {statusLabels[status] ?? "Aucun paiement de test confirmé."}
      </p>
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        disabled={busy || status === "processing"}
        onClick={() => void start()}
      >
        {busy
          ? "Ouverture de Stripe…"
          : status === "open" || status === "creating"
            ? "Reprendre le paiement fictif"
            : "Tester un paiement de 1 €"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => setRevision((value) => value + 1)}
      >
        Actualiser le résultat du test
      </button>
    </section>
  );
}
