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
  if (!accessToken) throw new Error("Connectez-vous Ã  Pilotoki.");
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
        throw new Error("CamÃ©ra indisponible. Ouvrez Pilotoki en HTTPS.");
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
          reason instanceof Error ? reason.message : "CamÃ©ra indisponible.",
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
          setError("Connexion LiveKit interrompue. VÃ©rifiez votre rÃ©seau.");
          setState("preview");
        }
      });
      await room.connect(access.url, access.token);
      const tracks = streamRef.current.getTracks();
      if (tracks.length < 2)
        throw new Error("La camÃ©ra et le microphone sont nÃ©cessaires.");
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
            : "Impossible d'envoyer la vidÃ©o Ã  LiveKit.",
        );
      }
    } finally {
      if (activeRef.current) setBusy(false);
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
      <h1>CamÃ©ra mobile Pilotoki Live</h1>
      <p>
        Votre tÃ©lÃ©phone peut envoyer sa camÃ©ra et son micro Ã  LiveKit. Cet Ã©cran
        ne dÃ©marre pas encore le direct public sur YouTube.
      </p>
      {!VIDEO_ID.test(videoId) ? (
        <p role="alert">
          SÃ©lectionnez d'abord un direct prÃ©parÃ© dans Pilotoki Live.
        </p>
      ) : (
        <>
          <video
            ref={previewRef}
            autoPlay
            playsInline
            muted
            aria-label="AperÃ§u de la camÃ©ra sur le tÃ©lÃ©phone"
            style={{ width: "100%", background: "#111", borderRadius: 12 }}
          />
          <p role="status">
            {state === "idle"
              ? "CamÃ©ra arrÃªtÃ©e"
              : state === "preview"
                ? "AperÃ§u local â aucune image transmise"
                : state === "connecting"
                  ? "Connexion sÃ©curisÃ©e et envoi vers LiveKitâ¦"
                  : "CamÃ©ra et micro publiÃ©s dans LiveKit â pas encore en direct sur YouTube"}
          </p>
          {error && <p role="alert">{error}</p>}
          {state === "idle" && (
            <button
              type="button"
              onClick={() => void openCamera()}
              disabled={busy}
            >
              Ouvrir ma camÃ©ra
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
                Connecter la camÃ©ra Ã  LiveKit
              </button>
            </>
          )}
          {state !== "idle" && (
            <button type="button" disabled={busy} onClick={() => void stop()}>
              ArrÃªter et dÃ©connecter la camÃ©ra
            </button>
          )}
        </>
      )}
      <p>
        <Link to="/admin/parametres/live">Retour Ã  Pilotoki Live</Link>
      </p>
    </main>
  );
}
