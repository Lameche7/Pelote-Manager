import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Room, RoomEvent } from "livekit-client";
import { supabase } from "@/infrastructure/supabase/client";

const VIDEO_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CameraState = "idle" | "preview" | "connecting" | "publishing";

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
  const [busy, setBusy] = useState(false);
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

  const openCamera = async () => {
    if (busy || !VIDEO_ID.test(videoId) || state !== "idle") return;
    setBusy(true);
    setError("");
    let stream: MediaStream | null = null;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error("Caméra indisponible. Ouvrez Pilotoki en HTTPS.");
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
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
      setState("preview");
    } catch (reason) {
      stream?.getTracks().forEach((track) => track.stop());
      if (activeRef.current)
        setError(
          reason instanceof Error ? reason.message : "Caméra indisponible.",
        );
    } finally {
      if (activeRef.current) setBusy(false);
    }
  };

  const connect = async () => {
    if (busy || !consent || state !== "preview" || !streamRef.current) return;
    setBusy(true);
    setState("connecting");
    setError("");
    let room: Room | null = null;
    try {
      const access = await fetchPublisherAccess(videoId);
      if (!activeRef.current || !streamRef.current) return;
      room = new Room({ adaptiveStream: false, dynacast: false });
      roomRef.current = room;
      room.on(RoomEvent.Disconnected, () => {
        if (activeRef.current && roomRef.current === room) {
          setError("Connexion LiveKit interrompue. Vérifiez votre réseau.");
          setState("preview");
        }
      });
      await room.connect(access.url, access.token);
      const tracks = streamRef.current.getTracks();
      if (tracks.length < 2)
        throw new Error("La caméra et le microphone sont nécessaires.");
      for (const track of tracks)
        await room.localParticipant.publishTrack(track);
      if (activeRef.current) setState("publishing");
    } catch (reason) {
      if (room) await room.disconnect().catch(() => undefined);
      if (roomRef.current === room) roomRef.current = null;
      if (activeRef.current) {
        setState("preview");
        setError(
          reason instanceof Error
            ? reason.message
            : "Impossible d'envoyer la vidéo à LiveKit.",
        );
      }
    } finally {
      if (activeRef.current) setBusy(false);
    }
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

  const goLive = async () => {
    if (egressBusy || state !== "publishing") return;
    setEgressBusy(true);
    setError("");
    setBroadcastMessage("");
    try {
      if (egressState === "idle") {
        const started = await controlLivekit("livekit_egress_start");
        if (!started.started)
          throw new Error("LiveKit n'a pas confirmé la retransmission.");
        setEgressState("feeding");
      }
      setBroadcastMessage(
        "LiveKit transmet à YouTube. Attente de la confirmation du signal…",
      );
      let last: unknown;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        if (attempt > 0)
          await new Promise<void>((resolve) =>
            window.setTimeout(resolve, 3500),
          );
        try {
          const published = await controlLivekit("livekit_youtube_publish");
          if (published.status !== "live" && published.status !== "liveStarting")
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
          ) break;
        }
      }
      throw last ?? new Error("YouTube n'a pas confirmé le direct.");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Démarrage du direct incertain.",
      );
    } finally {
      setEgressBusy(false);
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
      setBroadcastMessage("Direct terminé. Le replay sera disponible sur YouTube.");
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

  const stop = async () => {
    if (busy) return;
    setBusy(true);
    release();
    setState("idle");
    setBusy(false);
  };

  return (
    <main className="admin-page" style={{ maxWidth: 700, margin: "0 auto" }}>
      <h1>Caméra mobile Pilotoki Live</h1>
      <p>
        Votre téléphone peut envoyer sa caméra et son micro à LiveKit. Cet écran
        peut maintenant lancer un direct YouTube après validation de la connexion.
      </p>
      {!VIDEO_ID.test(videoId) ? (
        <p role="alert">
          Sélectionnez d'abord un direct préparé dans Pilotoki Live.
        </p>
      ) : (
        <>
          <video
            ref={previewRef}
            autoPlay
            playsInline
            muted
            aria-label="Aperçu de la caméra sur le téléphone"
            style={{ width: "100%", background: "#111", borderRadius: 12 }}
          />
          <p role="status">
            {state === "idle"
              ? "Caméra arrêtée"
              : state === "preview"
                ? "Aperçu local — aucune image transmise"
                : state === "connecting"
                  ? "Connexion sécurisée et envoi vers LiveKit…"
                  : "Caméra et micro publiés dans LiveKit — pas encore en direct sur YouTube"}
          </p>
          {error && <p role="alert">{error}</p>}
          {state === "idle" && (
            <button
              type="button"
              onClick={() => void openCamera()}
              disabled={busy}
            >
              Ouvrir ma caméra
            </button>
          )}
          {state === "preview" && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                Je confirme disposer des autorisations de captation et de
                diffusion des participants.
              </label>
              <button
                type="button"
                disabled={busy || !consent}
                onClick={() => void connect()}
              >
                Connecter la caméra à LiveKit
              </button>
            </>
          )}
          {state === "publishing" &&
            (egressState === "idle" || egressState === "feeding") && (
              <button
                type="button"
                disabled={egressBusy}
                onClick={() => void goLive()}
              >
                {egressBusy
                  ? "Lancement en cours…"
                  : egressState === "feeding"
                    ? "Réessayer de lancer le direct YouTube"
                    : "Diffuser cette partie sur YouTube"}
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
          {state !== "idle" &&
            (egressState === "idle" || egressState === "done") && (
            <button type="button" disabled={busy || egressBusy} onClick={() => void stop()}>
              Arrêter et déconnecter la caméra
            </button>
          )}
        </>
      )}
      <p>
        <Link to="/admin/parametres/live">Retour à Pilotoki Live</Link>
      </p>
    </main>
  );
}
