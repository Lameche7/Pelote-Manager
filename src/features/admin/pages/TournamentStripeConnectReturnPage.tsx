import { useEffect, useRef, useState } from "react";
import { supabase } from "@/infrastructure/supabase/client";
import { platformAdminLeaseService } from "@/features/platform/services/platformAdminLeaseService";

export function TournamentStripeConnectReturnPage() {
  const started = useRef(false);
  const [message, setMessage] = useState(
    "Vérification de la connexion Stripe…",
  );
  const [returnPath, setReturnPath] = useState("/");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const complete = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const raw = sessionStorage.getItem("pilotoki-stripe-connect");
        sessionStorage.removeItem("pilotoki-stripe-connect");
        window.history.replaceState(null, "", window.location.pathname);
        const saved = raw ? JSON.parse(raw) : null;
        if (
          typeof saved?.returnPath === "string" &&
          saved.returnPath.startsWith("/") &&
          !saved.returnPath.startsWith("//") &&
          !saved.returnPath.includes("\\")
        )
          setReturnPath(saved.returnPath);
        const state = params.get("state");
        const code = params.get("code");
        if (
          !saved ||
          !state ||
          state !== saved.state ||
          !code ||
          params.has("error")
        )
          throw new Error("Authorization cancelled or invalid");
        const result = await supabase.functions.invoke(
          "complete-tournament-stripe-connect",
          { body: { state, code } },
        );
        // A cross-club lease may have expired during the OAuth navigation.
        // Retry only the explicit authorization denial, before any Stripe token exchange.
        let { data, error } = result;
        if (
          error?.context instanceof Response &&
          error.context.status === 403 &&
          typeof saved.clubId === "string" &&
          typeof saved.returnPath === "string" &&
          new URL(saved.returnPath, window.location.origin).searchParams.has(
            "club",
          )
        ) {
          const lease = await platformAdminLeaseService.issue(saved.clubId);
          if (!lease.enabled) throw new Error("Club authorization unavailable");
          try {
            ({ data, error } = await supabase.functions.invoke(
              "complete-tournament-stripe-connect",
              { body: { state, code } },
            ));
          } finally {
            await platformAdminLeaseService.revoke().catch(() => undefined);
          }
        }
        if (error || data?.connected !== true || data.clubId !== saved.clubId)
          throw new Error("Connection not confirmed");
        setMessage(
          data.chargesEnabled
            ? "Compte Stripe connecté. Vous pouvez autoriser les paiements dans les paramètres du club."
            : "Compte Stripe connecté, mais les encaissements ne sont pas encore autorisés par Stripe.",
        );
      } catch {
        setMessage(
          "Connexion Stripe non confirmée. Revenez aux paramètres du club pour recommencer.",
        );
      }
    };
    void complete();
  }, []);
  return (
    <main>
      <h1>Connexion Stripe</h1>
      <p role="status">{message}</p>
      <a href={returnPath}>Retour aux paramètres du club</a>
    </main>
  );
}
