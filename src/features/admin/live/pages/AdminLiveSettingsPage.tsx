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

export function AdminLiveSettingsPage() {
  const [settings, setSettings] = useState<ClubLiveSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(false);
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

  useEffect(() => {
    let active = true;
    fetch("/api/live-google-configuration", { cache: "no-store" })
      .then(async (response) =>
        response.ok ? response.json() : { configured: false },
      )
      .then((result: { configured?: boolean }) => {
        if (active) setGoogleConfigured(result.configured === true);
      })
      .catch(() => {
        if (active) setGoogleConfigured(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const googleCallback = new URLSearchParams(window.location.search).get(
    "live_google",
  );

  const connectGoogle = async () => {
    if (connecting) return;
    setConnecting(true);
    setError("");
    try {
      await adminLiveSettingsService.connectGoogle();
    } catch (reason: unknown) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Connexion Google impossible.",
      );
      setConnecting(false);
    }
  };

  const change = (patch: Partial<ClubLiveSettings>) => {
    setSettings((current) => (current ? { ...current, ...patch } : current));
    setMessage("");
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!settings || saving) return;
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
          La chaîne YouTube Pilotoki est commune à tous les clubs. Réglez ici
          les préférences de diffusion de votre club. Le lancement de directs
          depuis Pilotoki sera ajouté dans une étape distincte, après la
          connexion sécurisée à YouTube.
        </p>
      </header>

      <div className="admin-live-settings__notice" role="status">
        <RadioTower aria-hidden="true" />
        <div>
          <strong>
            En préparation — la passerelle vidéo reste à connecter
          </strong>
          <p>
            {settings?.connectionStatus === "connected"
              ? "Chaîne YouTube Pilotoki autorisée pour le réseau. Le lancement du direct depuis un téléphone sera activé après intégration de la passerelle vidéo."
              : "La chaîne commune doit être autorisée une seule fois par son responsable. Aucun direct ne peut encore être lancé depuis Pilotoki."}
          </p>
        </div>
      </div>

      {googleCallback === "connected" && (
        <p role="status" className="admin-live-settings__success">
          Autorisation Google enregistrée. La chaîne peut maintenant être reliée
          aux futures diffusions.
        </p>
      )}
      {googleCallback === "error" && (
        <p role="alert" className="admin-live-settings__error">
          Connexion Google non terminée. Vérifiez le compte choisi et les
          autorisations Google.
        </p>
      )}

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
              <Video aria-hidden="true" /> Chaîne YouTube Pilotoki
            </h2>
            <p className="admin-live-settings__hint">
              Une seule chaîne YouTube pour tous les clubs. Seule
              l'administration centrale peut gérer l'autorisation Google.
            </p>
            <p>
              <strong>{settings.youtubeChannelLabel || "Pilotoki"}</strong>
            </p>
            <p>
              Identifiant YouTube : <code>{settings.youtubeChannelId}</code>
            </p>
            {Boolean(settings.youtubeChannelId) && (
              <a
                href={`https://www.youtube.com/channel/${settings.youtubeChannelId}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                Voir la chaîne sur YouTube <ExternalLink aria-hidden="true" />
              </a>
            )}
            <p className="admin-live-settings__hint">
              Le lien public n'autorise pas Pilotoki à gérer la chaîne. La
              connexion Google doit être validée une fois par son responsable.
              Aucun mot de passe ni clé YouTube ne doit être saisi ici.
            </p>
            <p role="status">
              <strong>Connexion Google :</strong>{" "}
              {settings.connectionStatus === "connected"
                ? "Chaîne autorisée"
                : "Autorisation nécessaire"}
            </p>
            {settings.connectionStatus !== "connected" &&
              settings.canConnectGoogle && (
                <button
                  type="button"
                  disabled={
                    !googleConfigured ||
                    connecting ||
                    saving ||
                    !settings.youtubeChannelId
                  }
                  onClick={() => void connectGoogle()}
                >
                  {connecting
                    ? "Ouverture de Google…"
                    : "Connecter la chaîne avec Google"}
                </button>
              )}
            {!googleConfigured && (
              <p className="admin-live-settings__hint" role="status">
                Connexion Google non configurée côté serveur. Le bouton sera
                activé après l'ajout des identifiants Google OAuth dans Vercel.
              </p>
            )}
            <small>
              {settings.canConnectGoogle
                ? "Utilisez le compte Google qui gère la chaîne Pilotoki."
                : "La connexion Google est réservée à l'administration pilote. Les préférences de diffusion restent propres à votre club."}
            </small>
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
              <li>
                Validation des directs par YouTube Studio sur la chaîne
                Pilotoki.
              </li>
              <li>Autorisation Google de la chaîne (bouton ci-dessus).</li>
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
