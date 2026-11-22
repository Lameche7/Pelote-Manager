import { createCipheriv, randomBytes } from "node:crypto";
import { LiveAuthError, required } from "./_live-google-shared.mjs";
import { privilegedHeaders } from "./_live-youtube-broadcast.mjs";

export function validateVideoId(value) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new LiveAuthError(400, "Identifiant de direct invalide.");
  return value;
}

export async function getClubVideo(env, clubId, videoId, fetchImpl = fetch, allowLive = false) {
  const url = required(env, "VITE_SUPABASE_URL");
  const params = new URLSearchParams({
    id: `eq.${validateVideoId(videoId)}`,
    club_id: `eq.${clubId}`,
    select: "id,club_id,youtube_video_id,title,status",
    limit: "1",
  });
  const response = await fetchImpl(
    `${url}/rest/v1/pilotoki_live_videos?${params}`,
    { headers: privilegedHeaders(env), cache: "no-store" },
  );
  if (!response.ok)
    throw new LiveAuthError(503, "Impossible de retrouver la partie.");
  const data = await response.json();
  const video = data?.[0];
  if (!video || (video.status !== "scheduled" && !(allowLive && video.status === "live")))
    throw new LiveAuthError(404, "Direct préparé introuvable pour ce club.");
  return video;
}

export async function existingIngest(env, videoId, fetchImpl = fetch) {
  const url = required(env, "VITE_SUPABASE_URL");
  const response = await fetchImpl(
    `${url}/rest/v1/pilotoki_live_ingest_credentials?video_id=eq.${validateVideoId(videoId)}&select=video_id`,
    { headers: privilegedHeaders(env), cache: "no-store" },
  );
  if (!response.ok)
    throw new LiveAuthError(503, "Vérification du flux indisponible.");
  const rows = await response.json();
  return Array.isArray(rows) && rows.length > 0;
}

export function encryptIngestCredentials(env, value) {
  // The same server-only 32-byte key already used for OAuth tokens.
  const key = Buffer.from(
    required(env, "YOUTUBE_TOKEN_ENCRYPTION_KEY"),
    "base64",
  );
  if (key.length !== 32)
    throw new LiveAuthError(503, "Clé de chiffrement invalide.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([
    cipher.update(data),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
  };
}

export async function youtubeCreateIngest(
  accessToken,
  title,
  fetchImpl = fetch,
) {
  const response = await fetchImpl(
    "https://www.googleapis.com/youtube/v3/liveStreams?part=snippet,cdn",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        snippet: { title },
        cdn: {
          ingestionType: "rtmp",
          resolution: "variable",
          frameRate: "variable",
        },
      }),
      cache: "no-store",
    },
  );
  if (!response.ok)
    throw new LiveAuthError(
      502,
      "YouTube a refusé de créer le flux RTMPS. Vérifiez que les directs sont activés.",
    );
  const data = await response.json();
  const id = data?.id;
  const address = data?.cdn?.ingestionInfo?.rtmpsIngestionAddress;
  const streamName = data?.cdn?.ingestionInfo?.streamName;
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(id ?? "") ||
    typeof address !== "string" ||
    !address.startsWith("rtmps://") ||
    typeof streamName !== "string" ||
    streamName.length < 1
  )
    throw new LiveAuthError(
      502,
      "YouTube n'a pas fourni une configuration RTMPS complète.",
    );
  return { id, address, streamName };
}

export async function youtubeBindIngest(
  accessToken,
  broadcastId,
  streamId,
  fetchImpl = fetch,
) {
  const params = new URLSearchParams({
    part: "id,contentDetails",
    id: broadcastId,
    streamId,
  });
  const response = await fetchImpl(
    `https://www.googleapis.com/youtube/v3/liveBroadcasts/bind?${params}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    },
  );
  if (!response.ok)
    throw new LiveAuthError(
      502,
      "YouTube a refusé d'associer le flux vidéo au direct.",
    );
}

export async function saveIngest(
  env,
  videoId,
  streamId,
  encrypted,
  fetchImpl = fetch,
) {
  const url = required(env, "VITE_SUPABASE_URL");
  const response = await fetchImpl(
    `${url}/rest/v1/pilotoki_live_ingest_credentials?on_conflict=video_id`,
    {
      method: "POST",
      headers: {
        ...privilegedHeaders(env),
        "content-type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify({
        video_id: videoId,
        youtube_stream_id: streamId,
        ingest_ciphertext: encrypted.ciphertext,
        ingest_iv: encrypted.iv,
      }),
      cache: "no-store",
    },
  );
  if (!response.ok)
    throw new LiveAuthError(
      502,
      "Flux lié à YouTube mais enregistrement sécurisé impossible. Contactez l'administration.",
    );
}
