import { useState } from "react";

export function TournamentStripeDiagnosticReturnPage() {
  const [returnPath] = useState(() => {
    try {
      const raw = sessionStorage.getItem("pilotoki-stripe-diagnostic-return");
      sessionStorage.removeItem("pilotoki-stripe-diagnostic-return");
      if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
      const destination = new URL(raw, window.location.origin);
      if (destination.origin !== window.location.origin) return "/";
      return destination.pathname + destination.search + destination.hash;
    } catch {
      return "/";
    }
  });

  return (
    <main>
      <h1>Retour du paiement fictif Stripe</h1>
      <p role="status">
        Le retour de Stripe ne confirme pas à lui seul le paiement. Consultez
        le résultat vérifié dans les paramètres du club.
      </p>
      <a href={returnPath}>Retour aux paramètres du club</a>
    </main>
  );
}
