import { useEffect, useState } from "react";
import {
  adminReservationService,
  type ReservationAdminSettings,
} from "@/features/admin/services/adminReservationService";
import "./AdminReservationsPage.css";

function eurosToCents(value: string): number {
  return Math.round(Number(value.replace(",", ".")) * 100);
}

function centsToEuros(value: number): string {
  return (value / 100).toFixed(2);
}

export function AdminReservationsPage() {
  const [settings, setSettings] = useState<ReservationAdminSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    adminReservationService
      .getSettings()
      .then((loadedSettings) => {
        if (mounted) setSettings(loadedSettings);
      })
      .catch((loadError: unknown) => {
        if (mounted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Chargement impossible.",
          );
        }
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  async function saveSettings() {
    if (!settings) return;

    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      await adminReservationService.updateSettings(settings);
      setMessage("Les paramètres de réservation ont été enregistrés.");
    } catch (saveError: unknown) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Enregistrement impossible.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading || !settings) {
    return (
      <section className="admin-reservations">
        <p>Chargement…</p>
      </section>
    );
  }

  return (
    <section
      className="admin-reservations"
      aria-labelledby="admin-reservations-title"
    >
      <header>
        <p className="admin-reservations__eyebrow">Administration</p>
        <h1 id="admin-reservations-title">Paramètres des réservations</h1>
        <p>
          Configurez les règles générales appliquées aux réservations du club.
        </p>
      </header>

      {error && (
        <p
          className="admin-reservations__alert admin-reservations__alert--error"
          role="alert"
        >
          {error}
        </p>
      )}
      {message && (
        <p className="admin-reservations__alert" role="status">
          {message}
        </p>
      )}

      <div className="admin-reservations__panel">
        <div className="admin-reservations__panel-heading">
          <div>
            <h2>Règles générales</h2>
            <p>
              Paiement, délais, tarifs et quotas appliqués aux utilisateurs.
            </p>
          </div>
          <span
            className={`admin-reservations__payment-state${
              settings.onlinePaymentEnabled
                ? " admin-reservations__payment-state--enabled"
                : ""
            }`}
          >
            {settings.onlinePaymentEnabled
              ? "Paiement en ligne activé"
              : "Paiement en ligne désactivé"}
          </span>
        </div>

        <div className="admin-reservations__form-grid">
          <label className="admin-reservations__field admin-reservations__field--wide">
            <span>Paiement en ligne</span>
            <select
              value={settings.onlinePaymentEnabled ? "enabled" : "disabled"}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  onlinePaymentEnabled: event.target.value === "enabled",
                })
              }
            >
              <option value="disabled">
                Désactivé — réservation confirmée directement
              </option>
              <option value="enabled">Activé</option>
            </select>
            <small>
              Désactivé : aucun checkout n’est créé et le bouton utilisateur
              affiche « Réserver ».
            </small>
          </label>

          {settings.onlinePaymentEnabled && (
            <label className="admin-reservations__field">
              <span>Mode de paiement</span>
              <select
                value={settings.paymentMode}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    paymentMode: event.target.value as "test" | "helloasso",
                  })
                }
              >
                <option value="test">Test — paiement simulé</option>
                <option value="helloasso">Production — HelloAsso</option>
              </select>
            </label>
          )}

          <label className="admin-reservations__field admin-reservations__field--wide">
            <span>Délai pour régler les 4 parts</span>
            <div className="admin-reservations__number-field">
              <input
                type="number"
                min="1"
                value={settings.splitPaymentTimeoutMinutes}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    splitPaymentTimeoutMinutes: Number(event.target.value),
                  })
                }
              />
              <small>minutes</small>
            </div>
            <small>
              Utilisé uniquement avec « Payer ma part ». Si les 4 parts ne sont
              pas réglées avant ce délai, la réservation en attente est libérée.
              Le nouveau délai s’applique aux prochaines réservations.
            </small>
          </label>

          <label className="admin-reservations__field">
            <span>Anticipation licencié</span>
            <div className="admin-reservations__number-field">
              <input
                type="number"
                min="0"
                value={settings.licenseeAdvanceHours}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    licenseeAdvanceHours: Number(event.target.value),
                  })
                }
              />
              <small>heures</small>
            </div>
          </label>

          <label className="admin-reservations__field">
            <span>Anticipation non licencié</span>
            <div className="admin-reservations__number-field">
              <input
                type="number"
                min="0"
                value={settings.publicAdvanceHours}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    publicAdvanceHours: Number(event.target.value),
                  })
                }
              />
              <small>heures</small>
            </div>
          </label>

          <label className="admin-reservations__field">
            <span>Tarif licencié</span>
            <div className="admin-reservations__number-field">
              <input
                inputMode="decimal"
                value={centsToEuros(settings.licenseePriceCents)}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    licenseePriceCents: eurosToCents(event.target.value),
                  })
                }
              />
              <small>€</small>
            </div>
          </label>

          <label className="admin-reservations__field">
            <span>Tarif non licencié</span>
            <div className="admin-reservations__number-field">
              <input
                inputMode="decimal"
                value={centsToEuros(settings.publicPriceCents)}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    publicPriceCents: eurosToCents(event.target.value),
                  })
                }
              />
              <small>€</small>
            </div>
          </label>

          <label className="admin-reservations__field">
            <span>Durée d’un créneau</span>
            <div className="admin-reservations__number-field">
              <input
                type="number"
                min="1"
                value={settings.defaultDurationMinutes}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    defaultDurationMinutes: Number(event.target.value),
                  })
                }
              />
              <small>minutes</small>
            </div>
          </label>

          <label className="admin-reservations__field">
            <span>Pas du calendrier</span>
            <div className="admin-reservations__number-field">
              <input
                type="number"
                min="1"
                value={settings.bookingStepMinutes}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    bookingStepMinutes: Number(event.target.value),
                  })
                }
              />
              <small>minutes</small>
            </div>
          </label>

          <label className="admin-reservations__field">
            <span>Délai minimum avant réservation</span>
            <div className="admin-reservations__number-field">
              <input
                type="number"
                min="0"
                value={settings.minimumNoticeMinutes}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    minimumNoticeMinutes: Number(event.target.value),
                  })
                }
              />
              <small>minutes</small>
            </div>
          </label>

          <label className="admin-reservations__field">
            <span>Délai d’annulation</span>
            <div className="admin-reservations__number-field">
              <input
                type="number"
                min="0"
                value={settings.cancellationNoticeHours}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    cancellationNoticeHours: Number(event.target.value),
                  })
                }
              />
              <small>heures avant</small>
            </div>
          </label>

          <label className="admin-reservations__field">
            <span>Quota licencié</span>
            <div className="admin-reservations__number-field">
              <input
                type="number"
                min="1"
                value={settings.licenseeMaxActiveReservations}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    licenseeMaxActiveReservations: Number(event.target.value),
                  })
                }
              />
              <small>réservations actives</small>
            </div>
          </label>

          <label className="admin-reservations__field">
            <span>Quota non licencié</span>
            <div className="admin-reservations__number-field">
              <input
                type="number"
                min="1"
                value={settings.publicMaxActiveReservations}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    publicMaxActiveReservations: Number(event.target.value),
                  })
                }
              />
              <small>réservations actives</small>
            </div>
          </label>
        </div>

        <div className="admin-reservations__actions">
          <button
            type="button"
            className="admin-reservations__save"
            disabled={isSaving}
            onClick={() => void saveSettings()}
          >
            {isSaving ? "Enregistrement…" : "Enregistrer les paramètres"}
          </button>
        </div>
      </div>
    </section>
  );
}
