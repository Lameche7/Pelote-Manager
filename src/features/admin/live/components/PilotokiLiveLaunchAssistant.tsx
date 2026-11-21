import { useEffect, useState } from "react";
import { ExternalLink, RadioTower, Video } from "lucide-react";
import {
  adminLiveSettingsService,
  type ClubBroadcastSummary,
  type UpstreamStreamInfo,
} from "@/features/admin/live/services/adminLiveSettingsService";

type Props = {
  broadcast: ClubBroadcastSummary;
  streams?: UpstreamStreamInfo[];
  canAssociate?: boolean;
};

export function PilotokiLiveLaunchAssistant({
  broadcast,
  streams = [],
  canAssociate = false,
}: Props) {
  const [selectedStreamId, setSelectedStreamId] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [boundStreamId, setBoundStreamId] = useState<string | null>(null);
  const [bindingLoaded, setBindingLoaded] = useState(false);
  const [bindingError, setBindingError] = useState("");
  const [bindingBusy, setBindingBusy] = useState(false);
  const [confirmedDestination, setConfirmedDestination] = useState(false);
  useEffect(() => {
    if (!canAssociate || broadcast.status !== "scheduled") return;
    let active = true;
    setBindingLoaded(false);
    adminLiveSettingsService
      .getUpstreamBinding(broadcast.id)
      .then((binding) => {
        if (!active) return;
        setBoundStreamId(binding?.streamId ?? null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setBindingError(
          error instanceof Error ? error.message : "Liaison indisponible.",
        );
      })
      .finally(() => {
        if (active) setBindingLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [broadcast.id, broadcast.status, canAssociate]);
  const saveBinding = async () => {
    if (!validStream || !confirmedDestination || bindingBusy || boundStreamId)
      return;
    setBindingError("");
    setBindingBusy(true);
    try {
      const binding = await adminLiveSettingsService.associateUpstreamStream(
        broadcast.id,
        validStream.id,
      );
      setBoundStreamId(binding.streamId);
      setConfirmedDestination(false);
    } catch (error) {
      setBindingError(
        error instanceof Error ? error.message : "Association impossible.",
      );
    } finally {
      setBindingBusy(false);
    }
  };
  const validStream = streams.find(
    (stream) =>
      stream.id === selectedStreamId && /^[0-9a-f-]{36}$/i.test(stream.id),
  );
  const studioUrl = validStream
    ? `https://studio.upstream.so/stream/${validStream.id}/builder?tab=studio`
    : "https://studio.upstream.so/";
  const validInvite =
    /^https:\/\/studio\.upstream\.so\/join\/[A-Za-z0-9_-]+\/?$/.test(
      inviteUrl.trim(),
    );
  const copyInvite = async () => {
    if (!validInvite) return;
    try {
      await navigator.clipboard.writeText(inviteUrl.trim());
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section
      className="admin-card admin-live-settings__launch-assistant"
      aria-label={`Régie de diffusion : ${broadcast.title}`}
    >
      <h3>
        <RadioTower aria-hidden="true" /> Régie de diffusion
      </h3>
      <p>
        <strong>{broadcast.title}</strong>
      </p>
      <p className="admin-live-settings__hint">
        Pilotoki prépare la fiche YouTube. La vidéo et le son passent
        actuellement par Upstream Live Studio : ces deux étapes restent
        manuelles et n'activent pas une caméra dans Pilotoki.
      </p>
      <ol>
        <li>
          Ouvrir Upstream et vérifier que la caméra du téléphone est connectée à
          la bonne diffusion.
        </li>
        <li>
          Vérifier dans la régie YouTube que la destination sélectionnée dans
          Upstream correspond bien à <strong>cette diffusion</strong>. Ne pas
          utiliser une autre clé de flux créée pour un autre direct.
        </li>
        <li>
          Attendre que YouTube affiche l'aperçu vidéo, puis déclencher
          volontairement « Passer au direct » dans YouTube Studio.
        </li>
        <li>
          Contrôler le résultat sur la page spectateur. À la fin, arrêter la
          diffusion dans YouTube puis dans Upstream.
        </li>
      </ol>
      {streams.length > 0 && (
        <label className="admin-live-settings__studio-selector">
          Flux Upstream à utiliser pour cette partie
          <select
            value={selectedStreamId}
            onChange={(event) => setSelectedStreamId(event.target.value)}
          >
            <option value="">Choisir explicitement le bon flux</option>
            {streams.map((stream) => (
              <option value={stream.id} key={stream.id}>
                {stream.name} — {stream.status}
              </option>
            ))}
          </select>
        </label>
      )}
      {canAssociate && broadcast.status === "scheduled" && (
        <div className="admin-live-settings__binding">
          <h4>Liaison permanente du direct</h4>
          {!bindingLoaded ? (
            <p>Vérification de l'association existante…</p>
          ) : boundStreamId ? (
            <p role="status">
              Flux Upstream associé :{" "}
              <strong>
                {streams.find((stream) => stream.id === boundStreamId)?.name ??
                  boundStreamId}
              </strong>
              . Cette liaison n'envoie pas encore de vidéo à YouTube.
            </p>
          ) : (
            <>
              <label className="admin-live-settings__checkbox">
                <input
                  type="checkbox"
                  checked={confirmedDestination}
                  onChange={(event) =>
                    setConfirmedDestination(event.target.checked)
                  }
                />
                J'ai vérifié dans Upstream que cette régie utilise
                exclusivement la destination YouTube prévue pour{" "}
                <strong>{broadcast.title}</strong> et qu'elle est arrêtée.
              </label>
              <button
                type="button"
                disabled={
                  !validStream ||
                  !confirmedDestination ||
                  bindingBusy
                }
                onClick={() => void saveBinding()}
              >
                {bindingBusy
                  ? "Association…"
                  : "Associer ce flux Upstream à cette vidéo"}
              </button>
              <p className="admin-live-settings__hint">
                Le choix est permanent : aucune réaffectation automatique vers
                un autre direct. Cette action ne démarre pas Upstream.
              </p>
            </>
          )}
          {bindingError && <p role="alert">{bindingError}</p>}
        </div>
      )}
      <p className="admin-live-settings__hint">
        Vérifiez les destinations YouTube dans Upstream avant toute mise en
        direct. Seule la liaison explicitement confirmée est enregistrée.
      </p>
      <label className="admin-live-settings__studio-selector">
        Lien invité caméra (copié depuis Upstream → Guests)
        <input
          type="url"
          autoComplete="off"
          spellCheck={false}
          value={inviteUrl}
          onChange={(event) => {
            setInviteUrl(event.target.value);
            setCopied(false);
          }}
          placeholder="https://studio.upstream.so/join/…"
        />
      </label>
      <div className="admin-live-settings__launch-actions">
        <button
          type="button"
          disabled={!validInvite}
          onClick={() => void copyInvite()}
        >
          {copied ? "Lien caméra copié" : "Copier le lien caméra"}
        </button>
        {validInvite && (
          <a href={inviteUrl.trim()} target="_blank" rel="noopener noreferrer">
            Ouvrir le lien caméra <ExternalLink aria-hidden="true" />
          </a>
        )}
      </div>
      <p className="admin-live-settings__hint">
        Ce lien d'invitation est privé et n'est pas enregistré dans Pilotoki.
        Envoyez-le uniquement à la personne qui filme et utilisez Firefox sur le
        Samsung si son navigateur habituel affiche une erreur.
      </p>
      <div className="admin-live-settings__launch-actions">
        <a href={studioUrl} target="_blank" rel="noopener noreferrer">
          <Video aria-hidden="true" />{" "}
          {validStream ? "Ouvrir cette régie Upstream" : "Ouvrir Upstream"}{" "}
          <ExternalLink aria-hidden="true" />
        </a>
        <a
          href="https://studio.youtube.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          <RadioTower aria-hidden="true" /> Régie YouTube{" "}
          <ExternalLink aria-hidden="true" />
        </a>
        <a
          href={broadcast.youtubeUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Voir la page spectateur <ExternalLink aria-hidden="true" />
        </a>
      </div>
      <p className="admin-live-settings__hint">
        Important : ces liens ouvrent les régies existantes. Aucun bouton
        ci-dessus ne déclenche ni n'arrête un direct automatiquement.
      </p>
    </section>
  );
}
