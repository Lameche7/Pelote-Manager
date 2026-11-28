import { useEffect, useState } from "react";
import { TournamentStripeDiagnostic } from "./TournamentStripeDiagnostic";
import { supabase } from "@/infrastructure/supabase/client";

type StripePolicy = {
  enabled: boolean;
  connected: boolean;
  test_connected?: boolean;
};

export function TournamentStripePolicyPanel({ clubId }: { clubId: string }) {
  const [policy, setPolicy] = useState<StripePolicy | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setPolicy(null);
    setError("");
    void supabase
      .rpc("admin_get_tournament_stripe_policy_for_club", {
        target_club_id: clubId,
      })
      .then(({ data, error }) => {
        if (!active) return;
        if (
          error ||
          typeof data?.enabled !== "boolean" ||
          typeof data?.connected !== "boolean"
        ) {
          setError("Paramètres Stripe indisponibles.");
          return;
        }
        setPolicy(data as StripePolicy);
      });
    return () => {
      active = false;
    };
  }, [clubId, revision]);

  const connect = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const { data, error } = await supabase.functions.invoke(
        "begin-tournament-stripe-connect",
        { body: { clubId } },
      );
      if (error || typeof data?.redirectUrl !== "string")
        throw new Error("Stripe indisponible");
      const destination = new URL(data.redirectUrl);
      if (
        destination.origin !== "https://connect.stripe.com" ||
        destination.pathname !== "/oauth/authorize"
      )
        throw new Error("Destination invalide");
      const state = destination.searchParams.get("state");
      if (!state || !/^[0-9a-f]{64}$/.test(state))
        throw new Error("Autorisation invalide");
      sessionStorage.setItem(
        "pilotoki-stripe-connect",
        JSON.stringify({
          state,
          clubId,
          returnPath: window.location.pathname + window.location.search,
        }),
      );
      window.location.assign(destination.href);
    } catch {
      setError("Impossible de démarrer la connexion Stripe.");
    } finally {
      setSaving(false);
    }
  };

  const change = async (enabled: boolean) => {
    if (!policy || saving || (enabled && !policy.connected)) return;
    if (
      enabled &&
      !window.confirm(
        "Autoriser les paiements par carte bancaire pour les tournois de ce club ?",
      )
    )
      return;
    setSaving(true);
    setError("");
    try {
      const { error } = await supabase.rpc(
        "admin_set_tournament_stripe_policy_for_club",
        { target_club_id: clubId, new_enabled: enabled },
      );
      if (error) throw error;
      setRevision((value) => value + 1);
    } catch {
      setError("Modification non confirmée. Actualisez les paramètres.");
      setPolicy(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <fieldset disabled={saving}>
      <legend>Carte bancaire – Stripe (tournois)</legend>
      {policy && (
        <>
          <p>
            {policy.connected
              ? "Compte Stripe vérifié."
              : policy.test_connected
                ? "Compte Stripe de test vérifié — encaissements fictifs autorisés."
                : "Compte Stripe non connecté ou non vérifié."}
          </p>
          <button type="button" onClick={() => void connect()}>
            {policy.connected || policy.test_connected
              ? "Reconnecter Stripe"
              : "Connecter mon compte Stripe"}
          </button>
          {policy.test_connected && !policy.connected && (
            <p>
              Le compte de test ne permet pas d’activer les paiements réels.
            </p>
          )}
          {policy.test_connected && !policy.connected && (
            <TournamentStripeDiagnostic key={clubId} clubId={clubId} />
          )}
          <label>
            <input
              type="checkbox"
              checked={policy.enabled}
              disabled={!policy.connected && !policy.enabled}
              onChange={(event) => void change(event.target.checked)}
            />{" "}
            Autoriser les paiements Stripe réels pour les tournois de ce club
          </label>
          <p>
            Ce réglage est enregistré séparément et ne modifie pas les modalités
            de paiement des licences.
          </p>
        </>
      )}
      {!policy && !error && <p role="status">Chargement de Stripe…</p>}
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={() => setRevision((value) => value + 1)}>
        Actualiser l’état Stripe
      </button>
    </fieldset>
  );
}
