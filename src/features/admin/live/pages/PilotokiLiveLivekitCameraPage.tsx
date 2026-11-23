import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Room, RoomEvent, Track } from "livekit-client";
import { supabase } from "@/infrastructure/supabase/client";

const VIDEO_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CameraState = "idle" | "connecting" | "publishing";

async function fetchPublisherAccess(videoId: string): Promise<{
  url: string;
  token: string;
  room: string;
}> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("Connectez-vous à Pilotoki.");
  const response = await fetch("/api/live-youtube-ingest", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "livekit_publisher_token",
      videoId,
    }),
    cache: "no-store",
  });
  const result = (await response.json()) as {
    url?: string;
    token?: string;
    room?: string;
    error?: string;
  };
  if (!response.ok)
    throw new Error(result.error ?? "Autorisation LiveKit indisponible.");
  if (
    typeof result.url !== "string" ||
    !result.url.startsWith("wss://") ||
    typeof result.token !== "string" ||
    typeof result.room !== "string"
  ) {
    throw new Error("Informations de connexion LiveKit invalides.");
  }
  return { url: result.url, token: result.token, room: result.room };
}

/**
 * Local preview is never an actual live. LiveKit publication and YouTube
 * RTMPS egress are separate, independently verified transitions.
 */
export function PilotokiLiveLivekitCameraPage() {
  const [searchParams] = useSearchParams();
  const videoId = searchParams.get("videoId") ?? "";
  const previewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const roomRef = useRef<Room | null>(null);
  const activeRef = useRef(true);
  const [state, setState] = useState<CameraState>("idle");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [egressState, setEgressState] = useState<
    "idle" | "feeding" | "live" | "done"
  >("idle");
  const [egressBusy, setEgressBusy] = useState(false);
  const [broadcastMessage, setBroadcastMessage] = useState("");

  const release = () => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) void room.disconnect();
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());
    if (previewRef.current) previewRef.current.srcObject = null;
  };

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      release();
    };
  }, []);

  const prepareYoutubeIngest = async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Reconnectez-vous à Pilotoki.");
    const response = await fetch("/api/live-youtube-ingest", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ videoId }),
      cache: "no-store",
    });
    const result = (await response.json()) as {
      status?: string;
      error?: string;
    };
    if (!response.ok || result.status !== "configured")
      throw new Error(result.error ?? "Préparation YouTube indisponible.");
  };

  const controlLivekit = async (
    action:
      | "livekit_egress_start"
      | "livekit_youtube_publish"
      | "livekit_youtube_finish"
      | "livekit_egress_abort",
  ) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Reconnectez-vous à Pilotoki.");
    const response = await fetch("/api/live-youtube-ingest", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ action, videoId, confirmed: true }),
      cache: "no-store",
    });
    const result = (await response.json()) as {
      started?: boolean;
      completed?: boolean;
      status?: string;
      error?: string;
    };
    if (!response.ok)
      throw new Error(result.error ?? "Pilotage du direct indisponible.");
    return result;
  };

  const diagnoseOutput = async (): Promise<string> => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return "";
      const response = await fetch("/api/live-youtube-ingest", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "livekit_egress_diagnostics", videoId }),
        cache: "no-store",
      });
      if (!response.ok) return "";
      const result = (await response.json()) as {
        active?: boolean;
        egressState?: string;
        streamState?: string;
        retries?: number;
      };
      if (!result.active)
        return " La sortie LiveKit n'est plus active. Ne relancez pas sans vérifier l'état du direct.";
      if (result.streamState === "failed")
        return " La destination RTMP LiveKit est en échec. Annulez l'envoi avant de réessayer.";
      if (result.streamState === "active")
        return " LiveKit indique une destination RTMP active, mais YouTube n'a pas validé le direct. Vérifiez le flux et l'état dans YouTube Studio.";
      return " LiveKit n'a pas encore confirmé de destination RTMP active. Vérifiez l'état de l'Egress.";
    } catch {
      return "";
    }
  };

  const startOneClick = async () => {
    if (
      egressBusy ||
      !consent ||
      !VIDEO_ID.test(videoId) ||
      egressState === "live" ||
      egressState === "done"
    )
      return;
    setEgressBusy(true);
    setError("");
    setBroadcastMessage("");
    let egressStarted = egressState === "feeding";
    try {
      if (!egressStarted) {
        setState("connecting");
        setBroadcastMessage("Préparation sécurisée de YouTube…");
        // Idempotent: existing stream is reused, no key is sent to the phone.
        await prepareYoutubeIngest();
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
          throw new Error("Caméra indisponible. Ouvrez Pilotoki en HTTPS.");
        setBroadcastMessage("Connexion de la caméra et du microphone…");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 60 },
          },
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        if (!activeRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (previewRef.current) {
          previewRef.current.srcObject = stream;
          await previewRef.current.play().catch(() => undefined);
        }
        const access = await fetchPublisherAccess(videoId);
        if (!activeRef.current) return;
        const room = new Room({ adaptiveStream: false, dynacast: false });
        roomRef.current = room;
        room.on(RoomEvent.Disconnected, () => {
          if (activeRef.current && roomRef.current === room) {
            setError("Connexion LiveKit interrompue. Vérifiez votre réseau.");
          }
        });
        await room.connect(access.url, access.token);
        const videoTrack = stream.getVideoTracks()[0];
        const audioTrack = stream.getAudioTracks()[0];
        if (!videoTrack || !audioTrack)
          throw new Error("Caméra et microphone nécessaires.");
        if (
          videoTrack.readyState !== "live" ||
          !videoTrack.enabled ||
          videoTrack.muted
        )
          throw new Error("La caméra n'envoie pas d'image.");
        if (audioTrack.readyState !== "live")
          throw new Error("Le microphone n'est plus actif.");
        await room.localParticipant.publishTrack(videoTrack, {
          source: Track.Source.Camera,
          simulcast: false,
          videoEncoding: { maxBitrate: 6_000_000, maxFramerate: 60 },
        });
        await room.localParticipant.publishTrack(audioTrack, {
          source: Track.Source.Microphone,
        });
        if (
          !room.localParticipant.getTrackPublication(Track.Source.Camera) ||
          !room.localParticipant.getTrackPublication(Track.Source.Microphone)
        )
          throw new Error("LiveKit n'a pas confirmé la caméra et le micro.");
        setState("publishing");
        setBroadcastMessage("Caméra connectée. Envoi vers YouTube…");
        const started = await controlLivekit("livekit_egress_start");
        if (!started.started)
          throw new Error("LiveKit n'a pas confirmé la retransmission.");
        egressStarted = true;
        setEgressState("feeding");
      }
      let last: unknown;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        if (attempt > 0)
          await new Promise<void>((resolve) =>
            window.setTimeout(resolve, 3500),
          );
        if (!activeRef.current) return;
        try {
          const published = await controlLivekit("livekit_youtube_publish");
          if (
            published.status !== "live" &&
            published.status !== "liveStarting"
          )
            throw new Error("Statut YouTube non confirmé.");
          setEgressState("live");
          setBroadcastMessage("DIRECT YOUTUBE EN COURS");
          return;
        } catch (reason) {
          last = reason;
          const message = reason instanceof Error ? reason.message : "";
          if (
            !message.includes("n'a pas encore reçu") &&
            !message.includes("sortie LiveKit n'est pas encore active")
          )
            break;
        }
      }
      throw last ?? new Error("YouTube n'a pas confirmé le direct.");
    } catch (reason) {
      const diagnosis = egressStarted ? await diagnoseOutput() : "";
      if (!egressStarted) {
        release();
        if (activeRef.current) setState("idle");
      }
      if (activeRef.current)
        setError(
          (reason instanceof Error
            ? reason.message
            : "Lancement incomplet. Vérifiez le direct avant de réessayer.") +
            diagnosis,
        );
    } finally {
      if (activeRef.current) setEgressBusy(false);
    }
  };

  const finishLive = async () => {
    if (egressBusy || egressState !== "live") return;
    setEgressBusy(true);
    setError("");
    try {
      const result = await controlLivekit("livekit_youtube_finish");
      if (!result.completed)
        throw new Error("Fin du direct YouTube non confirmée.");
      setEgressState("done");
      setBroadcastMessage(
        "Direct terminé. Le replay sera disponible sur YouTube.",
      );
      release();
      setState("idle");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Fin du direct non confirmée. Réessayez.",
      );
    } finally {
      setEgressBusy(false);
    }
  };

  const abortLivekit = async () => {
    if (egressBusy || egressState !== "feeding") return;
    setEgressBusy(true);
    setError("");
    try {
      await controlLivekit("livekit_egress_abort");
      setEgressState("idle");
      setBroadcastMessage("Envoi LiveKit arrêté. YouTube n'a pas été publié.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Arrêt de la sortie LiveKit non confirmé.",
      );
    } finally {
      setEgressBusy(false);
    }
  };

  return (
    <main className="admin-page" style={{ maxWidth: 700, margin: "0 auto" }}>
      <h1>Caméra mobile Pilotoki Live</h1>
      <p>
        Votre téléphone peut envoyer sa caméra et son micro à LiveKit. Cet écran
        peut maintenant lancer un direct YouTube après validation de la
        connexion.
      </p>
      {!VIDEO_ID.test(videoId) ? (
        <p role="alert">Sélectionnez d'abord une partie préparée dans Pilotoki Live.</p>
      ) : (
        <>
          <video
            ref={previewRef}
            autoPlay
            playsInline
            muted
            aria-label="Aperçu caméra du téléphone"
            style={{ width: "100%", background: "#111", borderRadius: 12 }}
          />
          {egressState === "idle" && (
            <label>
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              Je confirme disposer des autorisations de captation et de diffusion.
            </label>
          )}
          {(egressState === "idle" || egressState === "feeding") && (
            <button
              type="button"
              disabled={egressBusy || (egressState === "idle" && !consent)}
              onClick={() => void startOneClick()}
            >
              {egressBusy
                ? "Lancement en cours…"
                : egressState === "feeding"
                  ? "Réessayer la confirmation YouTube"
                  : "Diffuser la partie"}
            </button>
          )}
          {egressState === "feeding" && (
            <button
              type="button"
              disabled={egressBusy}
              onClick={() => void abortLivekit()}
            >
              Annuler l'envoi vers YouTube
            </button>
          )}
          {egressState === "live" && (
            <button
              type="button"
              disabled={egressBusy}
              onClick={() => void finishLive()}
            >
              Terminer le direct et préparer le replay
            </button>
          )}
          {broadcastMessage && <p role="status">{broadcastMessage}</p>}
          {state === "connecting" && !broadcastMessage && (
            <p role="status">Connexion sécurisée en cours…</p>
          )}
          {error && <p role="alert">{error}</p>}
        </>
      )}
      <p>
        <Link to="/admin/parametres/live">Retour à Pilotoki Live</Link>
      </p>
    </main>
  );
}
