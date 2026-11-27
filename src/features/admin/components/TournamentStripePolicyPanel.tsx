import { useEffect, useState } from "react";
import { supabase } from "@/infrastructure/supabase/client";

type StripePolicy = {
  enabled: boolean;
  connected: boolean;
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
              : "Compte Stripe non connecté ou non vérifié."}
          </p>
          <label>
            <input
              type="checkbox"
              checked={policy.enabled}
              disabled={!policy.connected && !policy.enabled}
              onChange={(event) => void change(event.target.checked)}
            />{" "}
            Autoriser les paiements Stripe pour les tournois de ce club
          </label>
          <p>
            Ce réglage est enregistré séparément et ne modifie pas les
            modalités de paiement des licences.
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
