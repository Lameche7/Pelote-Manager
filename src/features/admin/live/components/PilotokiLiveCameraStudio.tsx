import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  Mic,
  MicOff,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import "./PilotokiLiveCameraStudio.css";

type CameraFacing = "environment" | "user";

function cameraErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Accès à la caméra ou au micro refusé. Autorisez-les dans les paramètres du navigateur.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Aucune caméra ou aucun microphone compatible n'a été trouvé.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "La caméra est utilisée par une autre application ou n'est pas disponible.";
  }
  if (name === "OverconstrainedError") {
    return "La caméra ne prend pas en charge les réglages demandés.";
  }
  return "Impossible d'ouvrir la caméra. Vérifiez ses autorisations et réessayez.";
}

export function PilotokiLiveCameraStudio() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestIdRef = useRef(0);
  const openingRef = useRef(false);
  const mountedRef = useRef(true);
  const [active, setActive] = useState(false);
  const [opening, setOpening] = useState(false);
  const [facing, setFacing] = useState<CameraFacing>("environment");
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [error, setError] = useState("");

  const stop = useCallback(() => {
    // Invalidates any pending getUserMedia request before it can install a stream.
    requestIdRef.current += 1;
    openingRef.current = false;
    const current = streamRef.current;
    streamRef.current = null;
    current?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    if (mountedRef.current) {
      setActive(false);
      setOpening(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      openingRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  const open = useCallback(
    async (nextFacing: CameraFacing) => {
      // Mobile browsers may need time to release the old camera hardware.
      // Prevent rapid double taps from starting two competing capture requests.
      if (openingRef.current) return;
      stop();
      const requestId = requestIdRef.current;
      openingRef.current = true;
      setOpening(true);
      setError("");
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError(
          "La caméra nécessite un navigateur compatible ouvert en HTTPS.",
        );
        openingRef.current = false;
        setOpening(false);
        return;
      }
      try {
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: { ideal: nextFacing },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 },
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
          },
        };
        let stream: MediaStream | null = null;
        // Firefox/Android may report NotReadableError for a short interval
        // after track.stop(): retry only that transient camera-busy error.
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (attempt > 0) {
            await new Promise<void>((resolve) =>
              window.setTimeout(resolve, attempt * 350),
            );
          }
          if (!mountedRef.current || requestId !== requestIdRef.current) return;
          try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
            break;
          } catch (reason) {
            const name = reason instanceof DOMException ? reason.name : "";
            const isBusy =
              name === "NotReadableError" || name === "TrackStartError";
            if (!isBusy || attempt === 2) throw reason;
          }
        }
        if (!stream) return;
        if (!mountedRef.current || requestId !== requestIdRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        stream.getAudioTracks().forEach((track) => {
          track.enabled = microphoneEnabled;
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // iOS requires muted + playsInline for an autoplaying local preview.
          void videoRef.current.play().catch(() => {
            // The user can still press play in browsers that block autoplay.
          });
        }
        setFacing(nextFacing);
        setActive(true);
      } catch (reason) {
        if (mountedRef.current && requestId === requestIdRef.current) {
          setError(cameraErrorMessage(reason));
        }
      } finally {
        if (mountedRef.current && requestId === requestIdRef.current) {
          openingRef.current = false;
          setOpening(false);
        }
      }
    },
    [microphoneEnabled, stop],
  );

  const toggleMicrophone = () => {
    const enabled = !microphoneEnabled;
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
    setMicrophoneEnabled(enabled);
  };

  return (
    <section
      className="pilotoki-camera-studio admin-card"
      aria-labelledby="pilotoki-camera-heading"
    >
      <div className="pilotoki-camera-studio__heading">
        <h2 id="pilotoki-camera-heading">
          <Camera aria-hidden="true" /> Studio caméra — aperçu local
        </h2>
        <p>
          Vérifiez le cadrage et le son depuis votre téléphone avant le direct.
          <strong> Aucun flux n'est transmis à YouTube ni à Pilotoki.</strong>
        </p>
      </div>

      <div className="pilotoki-camera-studio__preview">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          aria-label="Aperçu en direct de la caméra, uniquement sur cet appareil"
        />
        {!active && (
          <div className="pilotoki-camera-studio__idle">
            <CameraOff aria-hidden="true" />
            <strong>Caméra arrêtée</strong>
            <span>Aucun enregistrement ni aucune diffusion</span>
          </div>
        )}
        {active && (
          <span className="pilotoki-camera-studio__local">
            <ShieldCheck aria-hidden="true" /> APERÇU LOCAL — PAS EN DIRECT
          </span>
        )}
      </div>
      {error && (
        <p className="pilotoki-camera-studio__error" role="alert">
          {error}
        </p>
      )}
      <div className="pilotoki-camera-studio__controls">
        {!active ? (
          <button
            type="button"
            onClick={() => void open(facing)}
            disabled={opening}
          >
            <Camera aria-hidden="true" />
            {opening ? "Ouverture de la caméra…" : "Tester ma caméra"}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() =>
                void open(facing === "environment" ? "user" : "environment")
              }
              disabled={opening}
            >
              <RefreshCw aria-hidden="true" /> Changer de caméra
            </button>
            <button type="button" onClick={toggleMicrophone}>
              {microphoneEnabled ? (
                <Mic aria-hidden="true" />
              ) : (
                <MicOff aria-hidden="true" />
              )}
              {microphoneEnabled ? "Couper le micro" : "Activer le micro"}
            </button>
            <button
              type="button"
              onClick={stop}
              className="pilotoki-camera-studio__stop"
            >
              <CameraOff aria-hidden="true" /> Arrêter la caméra
            </button>
          </>
        )}
      </div>
      <p className="pilotoki-camera-studio__hint">
        Ce test local ne crée pas de direct et n'utilise aucune donnée mobile
        pour envoyer de la vidéo. La diffusion réelle sera activée après
        installation d'une passerelle vidéo sécurisée.
      </p>
    </section>
  );
}
