import { useEffect, useState, type FormEvent } from "react";
import {
  ExternalLink,
  RadioTower,
  Save,
  ShieldCheck,
  Video,
} from "lucide-react";
import {
  adminLiveSettingsService,
  type ClubLiveSettings,
  type LiveBroadcasterPolicy,
} from "@/features/admin/live/services/adminLiveSettingsService";
import "./AdminLiveSettingsPage.css";

const youtubeIdPattern = /^UC[A-Za-z0-9_-]{22}$/;

export function AdminLiveSettingsPage() {
  const [settings, setSettings] = useState<ClubLiveSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    adminLiveSettingsService
      .get()
      .then((loaded) => {
        if (active) setSettings(loaded);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Impossible de charger les paramètres Pilotoki Live.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const change = (patch: Partial<ClubLiveSettings>) => {
    setSettings((current) => (current ? { ...current, ...patch } : current));
    setMessage("");
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!settings || saving) return;
    if (
      settings.youtubeChannelId &&
      !youtubeIdPattern.test(settings.youtubeChannelId)
    ) {
      setError("Saisissez un identifiant de chaîne YouTube valide (UC…).");
      return;
    }
    setError("");
    setMessage("");
    setSaving(true);
    try {
      const updated = await adminLiveSettingsService.save(settings);
      setSettings(updated);
      setMessage("Préférences Pilotoki Live enregistrées pour ce club.");
    } catch (reason: unknown) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Impossible d'enregistrer la configuration Pilotoki Live.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="admin-page">Chargement de Pilotoki Live…</section>
    );
  }

  return (
    <section className="admin-page admin-live-settings">
      <header className="admin-page__header">
        <p className="admin-page__eyebrow">Paramètres du club</p>
        <h1>Pilotoki Live</h1>
        <p className="admin-page__lead">
          Préparez la chaîne YouTube de votre club et les règles de diffusion.
          Le lancement de directs depuis Pilotoki sera ajouté dans une étape
          distincte, après la connexion sécurisée à YouTube.
        </p>
      </header>

      <div className="admin-live-settings__notice" role="status">
        <RadioTower aria-hidden="true" />
        <div>
          <strong>En préparation — aucun direct n'est activé</strong>
          <p>
            L'identifiant de la chaîne ne donne pas accès au compte YouTube.
            L'autorisation Google et la passerelle vidéo restent à intégrer. Les
            joueurs ne verront aucun bouton de diffusion pour le moment.
          </p>
        </div>
      </div>

      {error && (
        <p role="alert" className="admin-live-settings__error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="admin-live-settings__success">
          {message}
        </p>
      )}

      {!settings ? (
        <p className="admin-card">
          Impossible de charger le paramétrage. Vérifiez vos droits
          administrateur sur le club sélectionné.
        </p>
      ) : (
        <form
          onSubmit={(event) => void save(event)}
          className="admin-live-settings__form"
        >
          <article className="admin-card">
            <h2>
              <Video aria-hidden="true" /> Chaîne YouTube du club
            </h2>
            <label>
              Nom de la chaîne
              <input
                type="text"
                maxLength={120}
                value={settings.youtubeChannelLabel}
                onChange={(event) =>
                  change({ youtubeChannelLabel: event.target.value })
                }
                placeholder="Nom public de la chaîne"
              />
            </label>
            <label>
              Identifiant de la chaîne (UC…)
              <input
                type="text"
                value={settings.youtubeChannelId}
                onChange={(event) =>
                  change({ youtubeChannelId: event.target.value.trim() })
                }
                placeholder="UCxxxxxxxxxxxxxxxxxxxxxx"
                autoComplete="off"
              />
            </label>
            {youtubeIdPattern.test(settings.youtubeChannelId) && (
              <a
                href={`https://www.youtube.com/channel/${settings.youtubeChannelId}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                Voir la chaîne sur YouTube <ExternalLink aria-hidden="true" />
              </a>
            )}
            <p className="admin-live-settings__hint">
              Le lien public est enregistré, mais la chaîne n'est pas encore
              autorisée à diffuser via Pilotoki. Aucun mot de passe ni clé
              YouTube ne doit être saisi ici.
            </p>
          </article>

          <article className="admin-card">
            <h2>
              <ShieldCheck aria-hidden="true" /> Règles prévues pour les directs
            </h2>
            <label>
              Qui pourra demander à diffuser une partie ?
              <select
                value={settings.broadcasterPolicy}
                onChange={(event) =>
                  change({
                    broadcasterPolicy: event.target
                      .value as LiveBroadcasterPolicy,
                  })
                }
              >
                <option value="admin_only">Administrateurs uniquement</option>
                <option value="participants">Participants à la partie</option>
                <option value="approval_required">
                  Participants avec validation de l'administrateur
                </option>
              </select>
            </label>
            <label className="admin-live-settings__checkbox">
              <input
                type="checkbox"
                checked={settings.allowReplays}
                onChange={(event) =>
                  change({ allowReplays: event.target.checked })
                }
              />
              Prévoir l'affichage des replays dans la vidéothèque
            </label>
            <p className="admin-live-settings__hint">
              Ce sont des préférences pour la future version. Elles n'accordent
              actuellement aucun droit de lancer un direct et ne remplacent pas
              les autorisations de captation et de diffusion des joueurs.
            </p>
          </article>

          <article className="admin-card">
            <h2>Étapes restantes</h2>
            <ol>
              <li>Validation des directs par YouTube Studio.</li>
              <li>
                Autorisation Google de la chaîne par le responsable du club.
              </li>
              <li>Passerelle sécurisée entre la caméra mobile et YouTube.</li>
              <li>Tests de consentement, modération, direct et replay.</li>
            </ol>
          </article>

          <button type="submit" disabled={saving}>
            <Save aria-hidden="true" />
            {saving ? "Enregistrement…" : "Enregistrer les préférences Live"}
          </button>
        </form>
      )}
    </section>
  );
}
