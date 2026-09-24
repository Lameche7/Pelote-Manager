import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, ImagePlus, Monitor, Save, Trash2 } from "lucide-react";
import {
  adminTvSettingsService,
  type TvModeSettings,
} from "@/features/admin/settings/services/adminTvSettingsService";
import { clubMediaService, type ClubTvMedia } from "@/features/admin/club/services/clubMediaService";
import "./AdminTvSettingsPage.css";

const PUBLIC_TV_URL = "https://app.pelotemanager.fr/tv/pcl";

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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posters, setPosters] = useState<ClubTvMedia[]>([]);
  const [posterDuration, setPosterDuration] = useState("24");
  const [customUntil, setCustomUntil] = useState("");
  const [isUploadingPoster, setIsUploadingPoster] = useState(false);
  const [deletingPosterId, setDeletingPosterId] = useState<string | null>(null);

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

  useEffect(() => {
    clubMediaService.list().then((items) => setPosters(items.filter((item) => item.kind === "poster"))).catch(() => setError("Impossible de charger les affiches du Mode TV."));
  }, []);

  const selectedResourceCount = useMemo(
    () =>
      settings?.resources.filter((resource) => resource.selected).length ?? 0,
    [settings],
  );

  const publicUrl = PUBLIC_TV_URL;

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
    if (
      settings.viewDurationSeconds < 10 ||
      settings.viewDurationSeconds > 300
    ) {
      setError(
        "La durée de chaque écran doit être comprise entre 10 et 300 secondes.",
      );
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


  const uploadPoster = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setIsUploadingPoster(true);
    setError(null);
    setMessage(null);
    try {
      let activeUntil: string;
      if (posterDuration === "custom") {
        const date = new Date(customUntil);
        if (!customUntil || Number.isNaN(date.getTime()) || date <= new Date()) {
          throw new Error("Choisissez une date et une heure de fin futures.");
        }
        activeUntil = date.toISOString();
      } else {
        activeUntil = new Date(Date.now() + Number(posterDuration) * 3_600_000).toISOString();
      }
      const uploaded = await clubMediaService.upload("poster", file, activeUntil);
      setPosters((current) => [...current, uploaded]);
      setMessage("L’affiche a été ajoutée à la rotation du Mode TV.");
    } catch (uploadError: unknown) {
      setError(uploadError instanceof Error ? uploadError.message : "Ajout de l’affiche impossible.");
    } finally {
      setIsUploadingPoster(false);
    }
  };

  const removePoster = async (poster: ClubTvMedia) => {
    setDeletingPosterId(poster.id);
    setError(null);
    try {
      await clubMediaService.remove(poster);
      setPosters((current) => current.filter((item) => item.id !== poster.id));
      setMessage("Affiche supprimée.");
    } catch (removeError: unknown) {
      setError(removeError instanceof Error ? removeError.message : "Suppression impossible.");
    } finally {
      setDeletingPosterId(null);
    }
  };

  const posterStatus = (poster: ClubTvMedia) => {
    if (!poster.activeUntil) return "Inactive";
    const remaining = new Date(poster.activeUntil).getTime() - Date.now();
    if (remaining <= 0) return "Expirée";
    const hours = Math.ceil(remaining / 3_600_000);
    return hours >= 24 ? `Encore ${Math.ceil(hours / 24)} j` : `Encore ${hours} h`;
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
            Durée de chaque écran (secondes)
            <input
              type="number"
              min="10"
              max="300"
              step="5"
              value={settings.viewDurationSeconds}
              onChange={(event) =>
                updateSettings({
                  viewDurationSeconds: Number(event.target.value),
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
        <div className="admin-tv-settings__panel-heading">
          <div>
            <h2>Affiches & messages temporaires</h2>
            <p>Ajoutez une image qui apparaîtra comme un écran supplémentaire dans la rotation du Mode TV.</p>
          </div>
          <ImagePlus aria-hidden="true" />
        </div>

        <div className="admin-tv-settings__poster-controls">
          <label>
            Durée active
            <select value={posterDuration} onChange={(event) => setPosterDuration(event.target.value)}>
              <option value="24">24 heures</option>
              <option value="48">48 heures</option>
              <option value="72">72 heures</option>
              <option value="custom">Personnalisée</option>
            </select>
          </label>
          {posterDuration === "custom" && (
            <label>
              Fin d’affichage
              <input type="datetime-local" value={customUntil} onChange={(event) => setCustomUntil(event.target.value)} />
            </label>
          )}
          <label className="admin-tv-settings__poster-upload">
            <ImagePlus aria-hidden="true" />
            {isUploadingPoster ? "Ajout…" : "Ajouter une affiche"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={isUploadingPoster}
              onChange={(event) => {
                void uploadPoster(event.target.files);
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>

        {posters.length === 0 ? (
          <p className="admin-tv-settings__poster-empty">Aucune affiche enregistrée.</p>
        ) : (
          <div className="admin-tv-settings__posters">
            {posters.map((poster) => (
              <figure className="admin-tv-settings__poster" key={poster.id}>
                <img src={poster.publicUrl} alt={poster.originalName} />
                <figcaption>
                  <strong>{poster.originalName}</strong>
                  <span>{posterStatus(poster)}</span>
                </figcaption>
                <button type="button" disabled={deletingPosterId !== null} onClick={() => void removePoster(poster)} aria-label={`Supprimer ${poster.originalName}`}>
                  <Trash2 aria-hidden="true" />
                </button>
              </figure>
            ))}
          </div>
        )}
      </article>

      <article className="admin-tv-settings__panel">
        <h2>Lien permanent du Mode TV</h2>
        <p>
          Cette adresse est fixe et peut être conservée dans les favoris de la
          télévision. Enregistrez les paramètres avant de vérifier l’écran.
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
        <a
          className="admin-tv-settings__open-link"
          href={publicUrl}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink aria-hidden="true" /> Ouvrir l’écran TV
        </a>
      </article>

      <div className="admin-tv-settings__actions">
        <button
          className="admin-tv-settings__save-button"
          type="button"
          disabled={isSaving}
          onClick={() => void save()}
        >
          <Save aria-hidden="true" />
          {isSaving ? "Enregistrement…" : "Enregistrer les paramètres"}
        </button>
      </div>
    </section>
  );
}
