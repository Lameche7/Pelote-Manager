import { useEffect, useState } from "react";
import { ExternalLink, RadioTower, Video } from "lucide-react";
import {
  adminLiveSettingsService,
  type ClubBroadcastSummary,
  type UpstreamStreamInfo,
  type UpstreamControlStatus,
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
  const [destinationReady, setDestinationReady] = useState(false);
  const [confirmedPreparation, setConfirmedPreparation] = useState(false);
  const [confirmedDestination, setConfirmedDestination] = useState(false);
  const [controlStatus, setControlStatus] =
    useState<UpstreamControlStatus | null>(null);
  const [controlMessage, setControlMessage] = useState("");
  const [controlBusy, setControlBusy] = useState(false);
  const [confirmedControl, setConfirmedControl] = useState(false);
  useEffect(() => {
    if (!canAssociate || broadcast.status !== "scheduled") return;
    let active = true;
    setBindingLoaded(false);
    adminLiveSettingsService
      .getUpstreamBinding(broadcast.id)
      .then((binding) => {
        if (!active) return;
        setBoundStreamId(binding?.streamId ?? null);
        setDestinationReady(binding?.destinationConfigured === true);
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
  const prepareDestination = async () => {
    if (
      !boundStreamId ||
      !confirmedPreparation ||
      bindingBusy ||
      destinationReady
    )
      return;
    setBindingBusy(true);
    setBindingError("");
    try {
      await adminLiveSettingsService.prepareUpstreamDestination(broadcast.id);
      setDestinationReady(true);
      setConfirmedPreparation(false);
    } catch (reason: unknown) {
      setBindingError(
        reason instanceof Error ? reason.message : "Destination indisponible.",
      );
    } finally {
      setBindingBusy(false);
    }
  };
  const refreshControl = async () => {
    if (!destinationReady || !canAssociate) return;
    setControlMessage("");
    try {
      const next = await adminLiveSettingsService.getUpstreamControlStatus(
        broadcast.id,
      );
      setControlStatus(next);
    } catch (error) {
      setControlMessage(
        error instanceof Error
          ? error.message
          : "État de la régie indisponible.",
      );
    }
  };
  useEffect(() => {
    if (!destinationReady || !canAssociate) return;
    void refreshControl();
  }, [destinationReady, canAssociate, broadcast.id]);
  const issueControl = async (action: "start" | "stop") => {
    if (
      !confirmedControl ||
      controlBusy ||
      !controlStatus?.safe ||
      (action === "start" ? !controlStatus.canStart : !controlStatus.canStop)
    )
      return;
    setControlBusy(true);
    setControlMessage("");
    try {
      await adminLiveSettingsService.controlUpstream(broadcast.id, action);
      setControlMessage(
        action === "start"
          ? "Démarrage Upstream demandé. Confirmez séparément le direct dans YouTube Studio."
          : "Arrêt Upstream demandé. Vérifiez aussi la fin du direct dans YouTube Studio.",
      );
    } catch (error) {
      setControlMessage(
        error instanceof Error ? error.message : "Commande indisponible.",
      );
    } finally {
      setConfirmedControl(false);
      setControlBusy(false);
      try {
        setControlStatus(
          await adminLiveSettingsService.getUpstreamControlStatus(broadcast.id),
        );
      } catch {
        setControlStatus(null);
      }
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
                J'ai vérifié dans Upstream que cette régie utilise exclusivement
                la destination YouTube prévue pour{" "}
                <strong>{broadcast.title}</strong> et qu'elle est arrêtée.
              </label>
              <button
                type="button"
                disabled={!validStream || !confirmedDestination || bindingBusy}
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
          {boundStreamId && bindingLoaded && (
            <div className="admin-live-settings__binding">
              {destinationReady ? (
                <p role="status">
                  Destination YouTube préparée dans Upstream, en pause.
                  Vérifiez-la avant toute diffusion. Les autres destinations
                  éventuelles ne sont pas modifiées.
                </p>
              ) : (
                <>
                  <p>
                    Préparer automatiquement une nouvelle destination RTMPS pour{" "}
                    <strong>{broadcast.title}</strong>, sans modifier les
                    destinations existantes ni démarrer la diffusion.
                  </p>
                  <label className="admin-live-settings__checkbox">
                    <input
                      type="checkbox"
                      checked={confirmedPreparation}
                      onChange={(event) =>
                        setConfirmedPreparation(event.target.checked)
                      }
                    />
                    Je confirme vouloir créer une nouvelle destination YouTube
                    désactivée pour cette vidéo.
                  </label>
                  <button
                    type="button"
                    disabled={!confirmedPreparation || bindingBusy}
                    onClick={() => void prepareDestination()}
                  >
                    {bindingBusy
                      ? "Préparation…"
                      : "Préparer automatiquement la destination YouTube"}
                  </button>
                  <p className="admin-live-settings__hint">
                    Le flux YouTube doit d'abord être préparé dans Pilotoki.
                    Aucun bouton ici ne démarre la caméra ou le direct.
                  </p>
                </>
              )}
            </div>
          )}
          {destinationReady && (
            <div className="admin-live-settings__binding">
              <h4>Pilotage du direct</h4>
              {controlStatus ? (
                <>
                  <p>
                    Régie Upstream :{" "}
                    <strong>{controlStatus.streamStatus}</strong>. Destination
                    du direct :{" "}
                    <strong>{controlStatus.destinationStatus}</strong>.
                  </p>
                  {controlStatus.reason && (
                    <p role="alert">{controlStatus.reason}</p>
                  )}
                  {controlStatus.safe && (
                    <>
                      <label className="admin-live-settings__checkbox">
                        <input
                          type="checkbox"
                          checked={confirmedControl}
                          onChange={(event) =>
                            setConfirmedControl(event.target.checked)
                          }
                        />
                        Je confirme piloter uniquement cette vidéo YouTube. J'ai
                        vérifié la caméra et les autorisations de diffusion.
                      </label>
                      <div className="admin-live-settings__launch-actions">
                        <button
                          type="button"
                          disabled={
                            !confirmedControl ||
                            controlBusy ||
                            !controlStatus.canStart
                          }
                          onClick={() => void issueControl("start")}
                        >
                          Démarrer Upstream
                        </button>
                        <button
                          type="button"
                          disabled={
                            !confirmedControl ||
                            controlBusy ||
                            !controlStatus.canStop
                          }
                          onClick={() => void issueControl("stop")}
                        >
                          Arrêter Upstream
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <p>État du pilotage non vérifié.</p>
              )}
              <button
                type="button"
                disabled={controlBusy}
                onClick={() => void refreshControl()}
              >
                Actualiser l'état de la régie
              </button>
              {controlMessage && <p role="status">{controlMessage}</p>}
              <p className="admin-live-settings__hint">
                YouTube Studio exige encore de confirmer « Passer au direct ».
                Un flux Upstream possédant une destination principale ou une
                autre destination active est bloqué pour éviter toute diffusion
                involontaire.
              </p>
            </div>
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
