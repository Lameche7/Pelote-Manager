import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/infrastructure/supabase/client";

type PublishingState = "idle" | "capturing" | "connecting" | "connected";
const VIDEO_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function authenticatedWhip(
  videoId: string,
  payload: Record<string, string>,
  method: "POST" | "DELETE",
): Promise<{ answer?: string; session?: string; stopped?: boolean }> {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token)
    throw new Error("Connectez-vous à Pilotoki pour utiliser la caméra.");
  const response = await fetch("/api/live-youtube-ingest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${data.session.access_token}`,
    },
    body: JSON.stringify({
      action: method === "DELETE" ? "whip_close" : "whip_offer",
      videoId,
      ...payload,
    }),
    cache: "no-store",
  });
  const result = (await response.json()) as {
    answer?: string;
    session?: string;
    stopped?: boolean;
    error?: string;
  };
  if (!response.ok)
    throw new Error(result.error ?? "Passerelle vidéo indisponible.");
  return result;
}

async function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pc.removeEventListener("icegatheringstatechange", check);
      reject(new Error("La connexion réseau de la caméra a expiré."));
    }, 12000);
    function check() {
      if (pc.iceGatheringState === "complete") {
        window.clearTimeout(timeout);
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    }
    pc.addEventListener("icegatheringstatechange", check);
  });
}

/**
 * Mobile sender. The WHIP media service must be separately configured and
 * route the WebRTC feed to the YouTube encoder. This page never claims that
 * receiving WebRTC frames alone means the YouTube live is public.
 */
export function PilotokiLiveMobilePublisherPage() {
  const [params] = useSearchParams();
  const videoId = params.get("videoId") ?? "";
  const preview = useRef<HTMLVideoElement>(null);
  const media = useRef<MediaStream | null>(null);
  const peer = useRef<RTCPeerConnection | null>(null);
  const session = useRef<string | null>(null);
  const [state, setState] = useState<PublishingState>("idle");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const release = () => {
    peer.current?.close();
    peer.current = null;
    media.current?.getTracks().forEach((track) => track.stop());
    media.current = null;
    if (preview.current) preview.current.srcObject = null;
  };
  useEffect(() => {
    return () => {
      release();
      // The browser may terminate a page unexpectedly; the provider must
      // reclaim abandoned media sessions on its own inactivity timeout.
    };
  }, []);

  const openCamera = async () => {
    if (busy || !VIDEO_ID.test(videoId)) return;
    setBusy(true);
    setError("");
    try {
      release();
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error("Caméra indisponible : ouvrez Pilotoki en HTTPS.");
      media.current = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: true,
      });
      if (preview.current) {
        preview.current.srcObject = media.current;
        await preview.current.play().catch(() => undefined);
      }
      setState("capturing");
    } catch (reason) {
      release();
      setState("idle");
      setError(
        reason instanceof Error
          ? reason.message
          : "Impossible d'ouvrir la caméra.",
      );
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    if (!agreed || busy || state !== "capturing" || !media.current) return;
    setBusy(true);
    setState("connecting");
    setError("");
    try {
      const pc = new RTCPeerConnection();
      peer.current = pc;
      media.current
        .getTracks()
        .forEach((track) => pc.addTrack(track, media.current!));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);
      const localSdp = pc.localDescription?.sdp;
      if (!localSdp) throw new Error("Offre vidéo indisponible.");
      const result = await authenticatedWhip(
        videoId,
        { offer: localSdp },
        "POST",
      );
      if (!result.answer || !result.session)
        throw new Error("La passerelle n'a pas confirmé la connexion.");
      session.current = result.session;
      await pc.setRemoteDescription({ type: "answer", sdp: result.answer });
      setState("connected");
    } catch (reason) {
      peer.current?.close();
      peer.current = null;
      setState("capturing");
      setError(
        reason instanceof Error
          ? reason.message
          : "Connexion vidéo impossible.",
      );
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (busy) return;
    setBusy(true);
    const activeSession = session.current;
    session.current = null;
    try {
      if (activeSession)
        await authenticatedWhip(videoId, { session: activeSession }, "DELETE");
    } catch {
      setError(
        "La passerelle n'a pas confirmé la fermeture. Vérifiez la diffusion.",
      );
    } finally {
      release();
      setState("idle");
      setBusy(false);
    }
  };

  return (
    <main className="admin-page" style={{ maxWidth: 700, margin: "0 auto" }}>
      <h1>Caméra mobile Pilotoki Live</h1>
      <p>
        Filmez avec votre smartphone. Le lancement public YouTube est une étape
        distincte et nécessite une passerelle vidéo opérationnelle.
      </p>
      {!VIDEO_ID.test(videoId) ? (
        <p role="alert">
          Ouvrez cette page depuis une vidéo Pilotoki préparée.
        </p>
      ) : (
        <>
          <video
            ref={preview}
            autoPlay
            muted
            playsInline
            aria-label="Aperçu caméra sur ce téléphone"
            style={{ width: "100%", background: "#111", borderRadius: 12 }}
          />
          <p role="status">
            {state === "idle"
              ? "Caméra arrêtée"
              : state === "capturing"
                ? "Aperçu local : aucune vidéo envoyée"
                : state === "connecting"
                  ? "Connexion sécurisée à la passerelle…"
                  : "Envoi WebRTC établi. La diffusion YouTube doit encore être vérifiée."}
          </p>
          {error && <p role="alert">{error}</p>}
          {state === "idle" && (
            <button
              disabled={busy}
              type="button"
              onClick={() => void openCamera()}
            >
              Ouvrir ma caméra
            </button>
          )}
          {state === "capturing" && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(event) => setAgreed(event.target.checked)}
                />
                Je confirme les autorisations de captation et de diffusion.
              </label>
              <button
                type="button"
                disabled={busy || !agreed}
                onClick={() => void connect()}
              >
                Connecter ma caméra
              </button>
            </>
          )}
          {state !== "idle" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void disconnect()}
            >
              Arrêter la caméra
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
