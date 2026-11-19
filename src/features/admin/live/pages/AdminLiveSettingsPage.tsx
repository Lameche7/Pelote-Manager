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
  type PreparedBroadcast,
  type ClubBroadcastSummary,
} from "@/features/admin/live/services/adminLiveSettingsService";
import { PilotokiLiveCameraStudio } from "@/features/admin/live/components/PilotokiLiveCameraStudio";
import { PilotokiLiveTestStudio } from "@/features/admin/live/components/PilotokiLiveTestStudio";
import "./AdminLiveSettingsPage.css";

export function AdminLiveSettingsPage() {
  const [settings, setSettings] = useState<ClubLiveSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastType, setBroadcastType] = useState<
    "tournoi" | "championnat" | "other"
  >("tournoi");
  const [broadcastStart, setBroadcastStart] = useState("");
  const [madeForKids, setMadeForKids] = useState<"" | "yes" | "no">("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [prepared, setPrepared] = useState<PreparedBroadcast | null>(null);
  const [linkingVideoId, setLinkingVideoId] = useState<string | null>(null);
  const [linkedVideoIds, setLinkedVideoIds] = useState<string[]>([]);
  const [linkMessage, setLinkMessage] = useState("");
  const [linkError, setLinkError] = useState("");
  const [broadcasts, setBroadcasts] = useState<ClubBroadcastSummary[]>([]);
  const [prepareError, setPrepareError] = useState("");
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

  useEffect(() => {
    if (settings?.connectionStatus !== "connected") return;
    let active = true;
    adminLiveSettingsService
      .listBroadcasts()
      .then((items) => {
        if (active) setBroadcasts(items);
      })
      .catch(() => {
        // The preparation form remains usable if listing is unavailable.
      });
    return () => {
      active = false;
    };
  }, [settings?.clubId, settings?.connectionStatus]);

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

  const prepareBroadcast = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (preparing) return;
    setPrepareError("");
    setPrepared(null);
    if (!consentConfirmed) {
      setPrepareError(
        "Confirmez les autorisations de captation et de diffusion.",
      );
      return;
    }
    if (!broadcastStart || madeForKids === "") {
      setPrepareError("Complétez la date et la classification du public.");
      return;
    }
    const date = new Date(broadcastStart);
    if (Number.isNaN(date.getTime())) {
      setPrepareError("Date de diffusion invalide.");
      return;
    }
    setPreparing(true);
    try {
      const created = await adminLiveSettingsService.prepareBroadcast({
        title: broadcastTitle,
        sourceType: broadcastType,
        sourceId: null,
        scheduledStartTime: date.toISOString(),
        madeForKids: madeForKids === "yes",
        consentConfirmed: true,
        autoStart: true,
      });
      setPrepared(created);
      setBroadcastTitle("");
      const items = await adminLiveSettingsService
        .listBroadcasts()
        .catch(() => null);
      if (items) setBroadcasts(items);
    } catch (reason: unknown) {
      setPrepareError(
        reason instanceof Error
          ? reason.message
          : "Impossible de préparer le direct YouTube.",
      );
    } finally {
      setPreparing(false);
    }
  };

  const linkIngest = async (videoId: string) => {
    if (linkingVideoId) return;
    setLinkingVideoId(videoId);
    setLinkError("");
    setLinkMessage("");
    try {
      const message = await adminLiveSettingsService.linkYoutubeIngest(videoId);
      setLinkedVideoIds((ids) => [...new Set([...ids, videoId])]);
      setLinkMessage(message);
    } catch (reason: unknown) {
      setLinkError(
        reason instanceof Error
          ? reason.message
          : "Impossible de préparer le flux vidéo.",
      );
    } finally {
      setLinkingVideoId(null);
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
      {settings?.connectionStatus === "connected" && (
        <section className="admin-card admin-live-settings__prepare">
          <h2>
            <RadioTower aria-hidden="true" /> Préparer un direct YouTube
          </h2>
          <p className="admin-live-settings__hint">
            Cette action crée une diffusion non répertoriée sur la chaîne
            Pilotoki et l'associe à votre club. Elle ne démarre pas la vidéo :
            la passerelle caméra reste à intégrer.
          </p>
          <form onSubmit={(event) => void prepareBroadcast(event)}>
            <label>
              Titre de la partie
              <input
                type="text"
                minLength={5}
                maxLength={100}
                required
                value={broadcastTitle}
                onChange={(event) => setBroadcastTitle(event.target.value)}
                placeholder="Finale 4e série — Équipe A / Équipe B"
              />
            </label>
            <label>
              Type de rencontre
              <select
                value={broadcastType}
                onChange={(event) =>
                  setBroadcastType(
                    event.target.value as "tournoi" | "championnat" | "other",
                  )
                }
              >
                <option value="tournoi">Tournoi</option>
                <option value="championnat">Championnat</option>
                <option value="other">Partie libre / autre</option>
              </select>
            </label>
            <label>
              Date et heure prévues
              <input
                type="datetime-local"
                required
                value={broadcastStart}
                onChange={(event) => setBroadcastStart(event.target.value)}
              />
            </label>
            <label>
              Ce contenu est-il spécifiquement destiné aux enfants ?
              <select
                value={madeForKids}
                required
                onChange={(event) =>
                  setMadeForKids(event.target.value as "" | "yes" | "no")
                }
              >
                <option value="">Choisir une réponse</option>
                <option value="no">Non</option>
                <option value="yes">Oui</option>
              </select>
            </label>
            <label className="admin-live-settings__checkbox">
              <input
                type="checkbox"
                checked={consentConfirmed}
                onChange={(event) => setConsentConfirmed(event.target.checked)}
                required
              />
              Je confirme disposer des autorisations nécessaires pour filmer et
              diffuser les participants.
            </label>
            {prepareError && (
              <p role="alert" className="admin-live-settings__error">
                {prepareError}
              </p>
            )}
            {prepared && (
              <p role="status" className="admin-live-settings__success">
                Direct préparé sur YouTube :{" "}
                <a
                  href={prepared.youtubeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {prepared.title} <ExternalLink aria-hidden="true" />
                </a>
                . La diffusion caméra n'est pas encore active.
              </p>
            )}
            <button
              type="submit"
              disabled={preparing || !consentConfirmed || madeForKids === ""}
            >
              {preparing
                ? "Création sur YouTube…"
                : "Préparer le direct sur YouTube"}
            </button>
          </form>
          {broadcasts.length > 0 && (
            <div className="admin-live-settings__broadcasts">
              <h3>Directs préparés pour ce club</h3>
              <p className="admin-live-settings__hint">
                La liaison RTMPS crée la destination de diffusion sur YouTube,
                sans transmettre la caméra. Cette opération sera possible après
                l'activation des directs sur la chaîne.
              </p>
              {linkError && (
                <p role="alert" className="admin-live-settings__error">
                  {linkError}
                </p>
              )}
              {linkMessage && (
                <p role="status" className="admin-live-settings__success">
                  {linkMessage}
                </p>
              )}
              <ul>
                {broadcasts.map((video) => (
                  <li key={video.id}>
                    <a
                      href={video.youtubeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {video.title} <ExternalLink aria-hidden="true" />
                    </a>
                    <small>
                      {video.status === "scheduled"
                        ? "En préparation — vidéo non démarrée"
                        : video.status === "live"
                          ? "En direct"
                          : video.status === "replay"
                            ? "Replay"
                            : "Masquée"}
                    </small>
                    {video.status === "scheduled" && (
                      <button
                        type="button"
                        disabled={
                          linkingVideoId !== null ||
                          linkedVideoIds.includes(video.id)
                        }
                        onClick={() => void linkIngest(video.id)}
                      >
                        {linkingVideoId === video.id
                          ? "Liaison YouTube…"
                          : linkedVideoIds.includes(video.id)
                            ? "Flux YouTube lié"
                            : "Lier le flux vidéo YouTube"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      {settings?.connectionStatus === "connected" && (
        <>
          <PilotokiLiveCameraStudio />
          <PilotokiLiveTestStudio broadcasts={broadcasts} />
        </>
      )}
    </section>
  );
}
