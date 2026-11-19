import { useEffect, useRef, useState } from "react";
import { Camera, RadioTower, Square, VideoOff } from "lucide-react";
import {
  publishWhip,
  startLiveBridge,
  stopLiveBridge,
} from "../services/liveBridgeService";
import type { ClubBroadcastSummary } from "../services/adminLiveSettingsService";

/** Test-only: never claims that YouTube is live before observing it separately. */
export function PilotokiLiveTestStudio({
  broadcasts,
}: {
  broadcasts: ClubBroadcastSummary[];
}) {
  const [videoId, setVideoId] = useState("");
  const [state, setState] = useState<
    "idle" | "preview" | "connecting" | "publishing" | "stopping"
  >("idle");
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<{
    ticket: string;
    stopPublisher?: () => Promise<void>;
  } | null>(null);
  const workingRef = useRef(false);

  const stopAll = async () => {
    if (workingRef.current) return;
    workingRef.current = true;
    setState("stopping");
    const current = sessionRef.current;
    sessionRef.current = null;
    try {
      if (current?.stopPublisher) await current.stopPublisher();
    } catch {
      /* WHIP may already be offline; always revoke bridge session. */
    }
    try {
      if (current) await stopLiveBridge(current.ticket);
    } catch {
      setError(
        "L'arrêt distant n'a pas été confirmé. La session expire automatiquement.",
      );
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    workingRef.current = false;
    setState("idle");
  };

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      const current = sessionRef.current;
      if (current?.stopPublisher) void current.stopPublisher().catch(() => {});
      if (current) void stopLiveBridge(current.ticket).catch(() => {});
    };
  }, []);

  const preview = async () => {
    setError("");
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Ouvrez Pilotoki en HTTPS et autorisez la caméra et le microphone.",
        );
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setState("preview");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Caméra indisponible.",
      );
    }
  };

  const start = async () => {
    if (
      workingRef.current ||
      state !== "preview" ||
      !videoId ||
      !streamRef.current
    )
      return;
    workingRef.current = true;
    setError("");
    setState("connecting");
    try {
      const session = await startLiveBridge(videoId);
      sessionRef.current = { ticket: session.ticket };
      const publisher = await publishWhip(
        streamRef.current,
        session.whipUrl,
        session.publishToken,
      );
      sessionRef.current.stopPublisher = publisher.stop;
      setState("publishing");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Impossible de transmettre la vidéo.",
      );
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) await stopLiveBridge(session.ticket).catch(() => {});
      setState("preview");
    } finally {
      workingRef.current = false;
    }
  };

  const choices = broadcasts.filter((b) => b.status === "scheduled");
  return (
    <section className="admin-card" aria-labelledby="pilotoki-test-heading">
      <h2 id="pilotoki-test-heading">
        <RadioTower aria-hidden="true" /> Test réel — caméra vers passerelle
      </h2>
      <p>
        Réservé aux administrateurs. Préparez d'abord un direct YouTube{" "}
        <strong>non répertorié</strong>
        et liez son flux. Le test est désactivé côté serveur tant que la
        passerelle n'est pas configurée.
      </p>
      <label>
        Direct YouTube à utiliser pour le test
        <select
          value={videoId}
          onChange={(event) => setVideoId(event.target.value)}
          disabled={
            state === "connecting" ||
            state === "publishing" ||
            state === "stopping"
          }
        >
          <option value="">Sélectionner un direct préparé</option>
          {choices.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
        </select>
      </label>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        controls={false}
        style={{
          display: state === "idle" ? "none" : "block",
          width: "100%",
          maxWidth: 680,
          background: "#111",
          aspectRatio: "16 / 9",
        }}
        aria-label="Aperçu caméra local"
      />
      {state === "idle" && (
        <p>
          <VideoOff aria-hidden="true" /> Caméra arrêtée — aucune diffusion.
        </p>
      )}
      {state === "preview" && (
        <p role="status">
          Aperçu local uniquement. Rien n'est encore envoyé à YouTube.
        </p>
      )}
      {state === "connecting" && (
        <p role="status">Connexion à la passerelle vidéo…</p>
      )}
      {state === "publishing" && (
        <p role="status">
          Flux envoyé à la passerelle. Vérifiez séparément sur YouTube que le
          direct est réellement en ligne.
        </p>
      )}
      {state === "stopping" && (
        <p role="status">Arrêt de la transmission en cours…</p>
      )}
      {error && (
        <p role="alert" style={{ color: "var(--color-danger, #b42318)" }}>
          {error}
        </p>
      )}
      <div className="pilotoki-camera-studio__controls">
        {state === "idle" && (
          <button type="button" onClick={() => void preview()}>
            <Camera aria-hidden="true" /> Tester caméra et micro
          </button>
        )}
        {state === "preview" && (
          <button
            type="button"
            onClick={() => void start()}
            disabled={!videoId}
          >
            <RadioTower aria-hidden="true" /> Envoyer vers YouTube (test)
          </button>
        )}
        {state !== "idle" && (
          <button
            type="button"
            onClick={() => void stopAll()}
            disabled={state === "connecting" || state === "stopping"}
          >
            <Square aria-hidden="true" /> Arrêter
          </button>
        )}
      </div>
      <p>
        Gardez le téléphone branché, l'écran allumé et Pilotoki au premier plan.
        Le direct n'est pas automatiquement rendu public.
      </p>
    </section>
  );
}
