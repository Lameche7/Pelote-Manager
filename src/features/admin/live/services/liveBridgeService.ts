import { supabase } from "@/infrastructure/supabase/client";

export type LiveBridgeSession = {
  whipUrl: string;
  publishToken: string;
  ticket: string;
  expiresAt: string;
};

async function callBridge(payload: Record<string, unknown>) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Reconnectez-vous à Pilotoki.");
  const response = await fetch("/api/live-bridge-session", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const answer = await response.json();
  if (!response.ok)
    throw new Error(answer.error || "La passerelle vidéo est indisponible.");
  return answer;
}

export async function startLiveBridge(
  videoId: string,
): Promise<LiveBridgeSession> {
  return callBridge({ action: "start", videoId });
}
export async function stopLiveBridge(ticket: string): Promise<void> {
  await callBridge({ action: "stop", ticket });
}

/** Minimal WHIP publisher. Media is never sent to Pilotoki / Vercel. */
export async function publishWhip(
  stream: MediaStream,
  whipUrl: string,
  bearer: string,
): Promise<{ stop: () => Promise<void> }> {
  const connection = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  let sessionUrl: string | null = null;
  try {
    stream.getTracks().forEach((track) => connection.addTrack(track, stream));
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    await new Promise<void>((resolve, reject) => {
      if (connection.iceGatheringState === "complete") return resolve();
      const timeout = window.setTimeout(() => {
        connection.removeEventListener("icegatheringstatechange", onChange);
        reject(new Error("Connexion WebRTC trop lente : réessayez."));
      }, 12000);
      function onChange() {
        if (connection.iceGatheringState !== "complete") return;
        window.clearTimeout(timeout);
        connection.removeEventListener("icegatheringstatechange", onChange);
        resolve();
      }
      connection.addEventListener("icegatheringstatechange", onChange);
    });
    const response = await fetch(whipUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/sdp",
      },
      body: connection.localDescription?.sdp,
    });
    if (response.status !== 201)
      throw new Error(
        `La passerelle a refusé le flux vidéo (HTTP ${response.status}).`,
      );
    const location = response.headers.get("location");
    if (!location)
      throw new Error("La passerelle n'a pas renvoyé de session WHIP.");
    sessionUrl = new URL(location, whipUrl).href;
    if (new URL(sessionUrl).origin !== new URL(whipUrl).origin)
      throw new Error("Adresse de session WHIP inattendue.");
    const answer = await response.text();
    await connection.setRemoteDescription({ type: "answer", sdp: answer });
    return {
      stop: async () => {
        try {
          if (sessionUrl)
            await fetch(sessionUrl, {
              method: "DELETE",
              headers: { authorization: `Bearer ${bearer}` },
            });
        } finally {
          connection.close();
        }
      },
    };
  } catch (error) {
    connection.close();
    throw error;
  }
}
