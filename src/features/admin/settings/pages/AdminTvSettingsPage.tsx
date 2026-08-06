import { useEffect, useMemo, useState } from "react";
import { Copy, Monitor, RefreshCcw, Save } from "lucide-react";
import {
  adminTvSettingsService,
  type TvModeSettings,
} from "@/features/admin/settings/services/adminTvSettingsService";
import { ROUTES } from "@/shared/config";
import "./AdminTvSettingsPage.css";

const refreshOptions = [
  { value: 15, label: "Toutes les 15 secondes" },
  { value: 30, label: "Toutes les 30 secondes" },
  { value: 60, label: "Toutes les minutes" },
  { value: 120, label: "Toutes les 2 minutes" },
  { value: 300, label: "Toutes les 5 minutes" },
];

export function AdminTvSettingsPage() {
  const [settings, setSettings] = useState<TvModeSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    adminTvSettingsService
      .getSettings()
      .then((loadedSettings) => {
        if (mounted) setSettings(loadedSettings);
      })
      .catch((loadError: unknown) => {
        if (mounted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Chargement des paramètres impossible.",
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

  const selectedResourceCount = useMemo(
    () =>
      settings?.resources.filter((resource) => resource.selected).length ?? 0,
    [settings],
  );

  const publicUrl = settings
    ? `${window.location.origin}${ROUTES.tv}/${settings.publicToken}`
    : "";

  const updateSettings = (changes: Partial<TvModeSettings>) => {
    setSettings((current) => (current ? { ...current, ...changes } : current));
    setError(null);
    setMessage(null);
  };

  const toggleResource = (resourceId: string) => {
    if (!settings) return;
    updateSettings({
      resources: settings.resources.map((resource) =>
        resource.id === resourceId
          ? { ...resource, selected: !resource.selected }
          : resource,
      ),
    });
  };

  const validate = () => {
    if (!settings) return false;
    if (settings.displayEndTime <= settings.displayStartTime) {
      setError("La fin de la plage d’affichage doit suivre son début.");
      return false;
    }
    if (settings.isEnabled && selectedResourceCount === 0) {
      setError("Sélectionnez au moins un terrain avant d’activer le Mode TV.");
      return false;
    }
    if (settings.visibleSlotCount < 1 || settings.visibleSlotCount > 24) {
      setError("Le nombre de créneaux doit être compris entre 1 et 24.");
      return false;
    }
    return true;
  };

  const save = async () => {
    if (!settings || !validate()) return;
    setIsSaving(true);
    setError(null);
    setMessage(null);
    try {
      await adminTvSettingsService.saveSettings(settings);
      setMessage("Les paramètres du Mode TV ont été enregistrés.");
    } catch (saveError: unknown) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Enregistrement impossible.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const copyPublicUrl = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setMessage("Le lien du Mode TV a été copié.");
      setError(null);
    } catch {
      setError("La copie automatique est indisponible sur ce navigateur.");
    }
  };

  const rotatePublicToken = async () => {
    if (
      !window.confirm(
        "Régénérer le lien rendra immédiatement l’ancien lien inutilisable. Continuer ?",
      )
    ) {
      return;
    }

    setIsRotating(true);
    setError(null);
    setMessage(null);
    try {
      const publicToken = await adminTvSettingsService.rotatePublicToken();
      updateSettings({ publicToken });
      setMessage("Un nouveau lien public a été généré.");
    } catch (rotateError: unknown) {
      setError(
        rotateError instanceof Error
          ? rotateError.message
          : "Régénération du lien impossible.",
      );
    } finally {
      setIsRotating(false);
    }
  };

  if (isLoading) {
    return (
      <section className="admin-tv-settings">
        <p role="status">Chargement des paramètres du Mode TV…</p>
      </section>
    );
  }

  if (!settings) {
    return (
      <section className="admin-tv-settings" role="alert">
        <h1>Mode TV indisponible</h1>
        <p>{error ?? "Les paramètres n’ont pas pu être chargés."}</p>
      </section>
    );
  }

  return (
    <section
      className="admin-tv-settings"
      aria-labelledby="admin-tv-settings-title"
    >
      <header className="admin-tv-settings__header">
        <div>
          <p className="admin-tv-settings__eyebrow">Paramètres</p>
          <h1 id="admin-tv-settings-title">Mode TV</h1>
          <p>
            Préparez l’écran qui affichera les réservations du jour au bar du
            club, en gros caractères et sans aucune donnée sensible.
          </p>
        </div>
        <div
          className={`admin-tv-settings__status${settings.isEnabled ? " admin-tv-settings__status--enabled" : ""}`}
        >
          <Monitor aria-hidden="true" />
          <span>
            {settings.isEnabled ? "Mode TV activé" : "Mode TV désactivé"}
          </span>
        </div>
      </header>

      {error && (
        <p
          className="admin-tv-settings__alert admin-tv-settings__alert--error"
          role="alert"
        >
          {error}
        </p>
      )}
      {message && (
        <p className="admin-tv-settings__alert" role="status">
          {message}
        </p>
      )}

      <article className="admin-tv-settings__panel">
        <div className="admin-tv-settings__panel-heading">
          <div>
            <h2>Activation</h2>
            <p>
              Le lien public ne diffusera les réservations que lorsque cette
              option sera activée.
            </p>
          </div>
          <label className="admin-tv-settings__switch">
            <input
              type="checkbox"
              checked={settings.isEnabled}
              onChange={(event) =>
                updateSettings({ isEnabled: event.target.checked })
              }
            />
            <span aria-hidden="true" />
            {settings.isEnabled ? "Activé" : "Désactivé"}
          </label>
        </div>
      </article>

      <article className="admin-tv-settings__panel">
        <div className="admin-tv-settings__panel-heading">
          <div>
            <h2>Terrains affichés</h2>
            <p>
              Choisissez les terrains à présenter sur la télévision. Leur ordre
              ci-dessous sera conservé à l’écran.
            </p>
          </div>
          <strong>{selectedResourceCount} sélectionné(s)</strong>
        </div>

        <div className="admin-tv-settings__resources">
          {settings.resources.length === 0 ? (
            <p>Aucun terrain actif n’est disponible.</p>
          ) : (
            settings.resources.map((resource) => (
              <label key={resource.id}>
                <input
                  type="checkbox"
                  checked={resource.selected}
                  onChange={() => toggleResource(resource.id)}
                />
                <span>{resource.name}</span>
              </label>
            ))
          )}
        </div>
      </article>

      <article className="admin-tv-settings__panel">
        <h2>Affichage</h2>
        <div className="admin-tv-settings__grid">
          <label>
            Début de la plage visible
            <input
              type="time"
              value={settings.displayStartTime}
              onChange={(event) =>
                updateSettings({ displayStartTime: event.target.value })
              }
            />
          </label>
          <label>
            Fin de la plage visible
            <input
              type="time"
              value={settings.displayEndTime}
              onChange={(event) =>
                updateSettings({ displayEndTime: event.target.value })
              }
            />
          </label>
          <label>
            Nombre maximal de créneaux
            <input
              type="number"
              min="1"
              max="24"
              value={settings.visibleSlotCount}
              onChange={(event) =>
                updateSettings({
                  visibleSlotCount: Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            Actualisation automatique
            <select
              value={settings.refreshIntervalSeconds}
              onChange={(event) =>
                updateSettings({
                  refreshIntervalSeconds: Number(event.target.value),
                })
              }
            >
              {refreshOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div
          className="admin-tv-settings__preview"
          aria-label="Aperçu du format TV"
        >
          <span>18h30</span>
          <strong>Réservé</strong>
          <span>Nom</span>
        </div>
      </article>

      <article className="admin-tv-settings__panel">
        <h2>Lien public sécurisé</h2>
        <p>
          Ce lien est difficile à deviner et pourra être ouvert sur la
          télévision sans connexion. L’écran correspondant sera branché dans la
          prochaine étape.
        </p>
        <div className="admin-tv-settings__url">
          <input
            aria-label="Lien public du Mode TV"
            readOnly
            value={publicUrl}
          />
          <button type="button" onClick={() => void copyPublicUrl()}>
            <Copy aria-hidden="true" /> Copier
          </button>
        </div>
        <button
          className="admin-tv-settings__secondary-button"
          type="button"
          disabled={isRotating}
          onClick={() => void rotatePublicToken()}
        >
          <RefreshCcw aria-hidden="true" />
          {isRotating ? "Régénération…" : "Régénérer le lien"}
        </button>
        <small>
          La régénération invalide immédiatement l’adresse précédente.
        </small>
      </article>

      <div className="admin-tv-settings__actions">
        <button
          className="admin-tv-settings__save-button"
          type="button"
          disabled={isSaving || isRotating}
          onClick={() => void save()}
        >
          <Save aria-hidden="true" />
          {isSaving ? "Enregistrement…" : "Enregistrer les paramètres"}
        </button>
      </div>
    </section>
  );
}
