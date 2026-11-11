import { useEffect, useState, type FormEvent } from "react";
import {
  clubPaymentPolicyService,
  type ClubPaymentPolicy,
} from "@/features/admin/services/clubPaymentPolicyService";
import "./AdminPaymentsPage.css";

export function AdminPaymentSettingsPage() {
  const [policy, setPolicy] = useState<ClubPaymentPolicy | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void clubPaymentPolicyService
      .get()
      .then(setPolicy)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Chargement impossible."),
      );
  }, []);

  function patch(value: Partial<ClubPaymentPolicy>) {
    setPolicy((current) => (current ? { ...current, ...value } : current));
    setMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policy) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await clubPaymentPolicyService.save(policy);
      setMessage(
        "Préférences enregistrées. Les flux de paiement existants restent inchangés tant que leur raccordement n'est pas activé.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  if (!policy)
    return (
      <section className="admin-payments">
        <h1>Paramètres de paiement</h1>
        <p role="status">{error || "Chargement…"}</p>
      </section>
    );

  return (
    <section className="admin-payments">
      <header>
        <p className="admin-payments__eyebrow">Administration · Paramètres</p>
        <h1>Paiements du club</h1>
        <p>
          Choisissez vos règles pour les licences et les tournois. Cette
          première étape enregistre les préférences sans modifier les
          encaissements existants.
        </p>
      </header>
      {error && (
        <p
          role="alert"
          className="admin-payments__alert admin-payments__alert--error"
        >
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="admin-payments__alert">
          {message}
        </p>
      )}
      <form
        onSubmit={(event) => void submit(event)}
        style={{ display: "grid", gap: 20, maxWidth: 720 }}
      >
        <fieldset>
          <legend>Moyens de paiement envisagés</legend>
          <label>
            <input
              type="checkbox"
              checked={policy.helloassoEnabled}
              onChange={(e) => patch({ helloassoEnabled: e.target.checked })}
            />{" "}
            HelloAsso (connexion propre au club nécessaire)
          </label>
          <label>
            <input
              type="checkbox"
              checked={policy.cashEnabled}
              onChange={(e) => patch({ cashEnabled: e.target.checked })}
            />{" "}
            Espèces
          </label>
          <label>
            <input
              type="checkbox"
              checked={policy.chequeEnabled}
              onChange={(e) => patch({ chequeEnabled: e.target.checked })}
            />{" "}
            Chèque
          </label>
          <label>
            <input
              type="checkbox"
              checked={policy.bankTransferEnabled}
              onChange={(e) => patch({ bankTransferEnabled: e.target.checked })}
            />{" "}
            Virement
          </label>
        </fieldset>
        <fieldset>
          <legend>Licences</legend>
          <label>
            Validation de la demande
            <select
              value={policy.licenceConfirmation}
              onChange={(e) =>
                patch({
                  licenceConfirmation: e.target
                    .value as ClubPaymentPolicy["licenceConfirmation"],
                })
              }
            >
              <option value="deferred">Paiement différé autorisé</option>
              <option value="payment_required">
                Paiement en ligne obligatoire
              </option>
            </select>
          </label>
        </fieldset>
        <fieldset>
          <legend>Inscriptions aux tournois</legend>
          <label>
            Confirmation de l'inscription
            <select
              value={policy.tournamentConfirmation}
              onChange={(e) =>
                patch({
                  tournamentConfirmation: e.target
                    .value as ClubPaymentPolicy["tournamentConfirmation"],
                })
              }
            >
              <option value="deferred">
                Inscription possible avant règlement
              </option>
              <option value="payment_required">
                Paiement en ligne obligatoire
              </option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={policy.tournamentHoldPlace}
              onChange={(e) => patch({ tournamentHoldPlace: e.target.checked })}
            />{" "}
            Réserver provisoirement la place en attente de paiement
          </label>
          {policy.tournamentHoldPlace && (
            <label>
              Délai maximal de réservation (heures)
              <input
                type="number"
                min={1}
                max={720}
                required
                value={policy.tournamentHoldHours}
                onChange={(e) =>
                  patch({ tournamentHoldHours: Number(e.target.value) })
                }
              />
            </label>
          )}
        </fieldset>
        <p>
          Note : activer HelloAsso ici ne connecte pas automatiquement le compte
          d'un autre club. Le raccordement sécurisé sera développé séparément.
        </p>
        <button type="submit" disabled={saving}>
          {saving ? "Enregistrement…" : "Enregistrer les préférences"}
        </button>
      </form>
    </section>
  );
}
