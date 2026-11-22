// LiveKit Cloud Egress -> the EXACT YouTube stream bound to a Pilotoki video.
// API keys and RTMPS secrets must never reach the browser.
import { createHmac, randomUUID } from "node:crypto";
import { LiveAuthError } from "./_live-google-shared.mjs";
import { livekitConfig } from "./_live-livekit.mjs";
import {
  loadYoutubeIngest,
  decryptYoutubeIngest,
} from "./_live-upstream-destination.mjs";
import { getClubVideo } from "./_live-youtube-ingest.mjs";
import {
  googleAccessToken,
  synchronizeClubVideos,
} from "./_live-youtube-broadcast.mjs";
import {
  publishVerifiedYoutubeLive,
  completeVerifiedYoutubeLive,
} from "./_live-youtube-publish.mjs";

function signingToken(key, secret, now = Date.now()) {
  const ts = Math.floor(now / 1000);
  const json = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = json({ alg: "HS256", typ: "JWT" });
  const body = json({
    iss: key,
    sub: "pilotoki-egress",
    iat: ts,
    nbf: ts - 5,
    exp: ts + 120,
    jti: randomUUID(),
    video: { roomRecord: true },
  });
  const signed = `${header}.${body}`;
  return `${signed}.${createHmac("sha256", secret).update(signed).digest("base64url")}`;
}

// Twirp JSON responds with protobuf field names in snake_case. Accept
// camelCase too for compatibility with JS SDK-style test doubles.
function egressId(item) {
  return item?.egress_id ?? item?.egressId;
}
function egressRoom(item) {
  return item?.room_name ?? item?.roomName;
}

const ACTIVE = new Set([
  0,
  1,
  2,
  "EGRESS_STARTING",
  "EGRESS_ACTIVE",
  "EGRESS_ENDING",
]);

async function twirp(env, method, body, fetchImpl = fetch) {
  const { apiKey, apiSecret, url } = livekitConfig(env);
  const endpoint = new URL(url);
  endpoint.protocol = "https:";
  endpoint.pathname = `/twirp/livekit.Egress/${method}`;
  let response;
  try {
    response = await fetchImpl(endpoint.href, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${signingToken(apiKey, apiSecret)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new LiveAuthError(
      503,
      "Connexion LiveKit incertaine. Vérifiez l'état avant de réessayer.",
    );
  }
  if (!response.ok)
    throw new LiveAuthError(
      502,
      `LiveKit a refusé ${method}. Vérifiez votre quota de transcodage et la caméra.`,
    );
  const result = await response.json();
  if (!result || typeof result !== "object")
    throw new LiveAuthError(502, "Réponse LiveKit invalide.");
  return result;
}

export function livekitRoom(clubId, videoId) {
  return `pilotoki-${clubId}-${videoId}`;
}

async function activeEgress(env, room, fetchImpl) {
  const result = await twirp(env, "ListEgress", { room_name: room }, fetchImpl);
  const items = result.items ?? [];
  if (!Array.isArray(items))
    throw new LiveAuthError(502, "Liste des directs LiveKit invalide.");
  return items.filter(
    (item) =>
      egressRoom(item) === room &&
      typeof egressId(item) === "string" &&
      ACTIVE.has(item.status),
  );
}

// Do not expose RTMP URLs or provider errors to client diagnostics.
function streamHealth(item) {
  const streams = item.stream_results ?? item.streamResults ?? [];
  if (!Array.isArray(streams) || streams.length === 0)
    return { streamState: "pending", retries: 0 };
  const statuses = streams.map((stream) => stream.status);
  const failed = statuses.includes(2) || statuses.includes("FAILED");
  const live = statuses.includes(0) || statuses.includes("ACTIVE");
  const retries = streams.map((stream) => Number(stream.retries) || 0);
  return {
    streamState: failed ? "failed" : live ? "active" : "pending",
    retries: Math.max(0, ...retries),
  };
}

/** Read-only, sanitized diagnostics for the selected room's RTMP output. */
export async function livekitEgressDiagnostics(
  env,
  clubId,
  videoId,
  fetchImpl = fetch,
) {
  const room = livekitRoom(clubId, videoId);
  const active = await activeEgress(env, room, fetchImpl);
  if (active.length === 0)
    return {
      active: false,
      egressState: "inactive",
      streamState: "unknown",
      retries: 0,
    };
  const egress = active[0];
  let egressState = "active";
  if ([0, "EGRESS_STARTING"].includes(egress.status))
    egressState = "starting";
  if ([2, "EGRESS_ENDING"].includes(egress.status))
    egressState = "ending";
  return {
    active: true,
    egressState,
    ...streamHealth(egress),
  };
}

export async function livekitEgressStatus(
  env,
  clubId,
  videoId,
  fetchImpl = fetch,
) {
  const room = livekitRoom(clubId, videoId);
  const active = await activeEgress(env, room, fetchImpl);
  return {
    active: active.length > 0,
    starting: active.some((item) =>
      [0, "EGRESS_STARTING"].includes(item.status),
    ),
    count: active.length,
  };
}

/** Only start for a prepared YouTube ingest and one authenticated publisher. */
export async function startLivekitEgress(
  env,
  clubId,
  video,
  publisherIdentity,
  fetchImpl = fetch,
) {
  if (video.status !== "scheduled")
    throw new LiveAuthError(409, "Ce direct YouTube n'est plus programmé.");
  if (!/^pilotoki-camera-[0-9a-f-]{36}$/i.test(publisherIdentity))
    throw new LiveAuthError(403, "Diffuseur LiveKit invalide.");
  const room = livekitRoom(clubId, video.id);
  const current = await activeEgress(env, room, fetchImpl);
  // A previous StartEgress may have succeeded despite an unrecognized
  // response. Reuse the one active room egress; never launch a duplicate.
  if (current.length === 1)
    return {
      started: true,
      active: [1, "EGRESS_ACTIVE"].includes(current[0].status),
      alreadyStarted: true,
    };
  if (current.length > 1)
    throw new LiveAuthError(
      409,
      "Plusieurs retransmissions LiveKit existent : vérification manuelle nécessaire.",
    );

  const ingest = await loadYoutubeIngest(env, video.id, fetchImpl);
  const url = decryptYoutubeIngest(env, ingest);
  const result = await twirp(
    env,
    "StartEgress",
    {
      room_name: room,
      media: {
        participant_video: { identity: publisherIdentity },
        audio: {
          routes: [
            {
              participant_identity: publisherIdentity,
              channel: "AUDIO_CHANNEL_BOTH",
            },
          ],
        },
      },
      outputs: [{ stream: { protocol: "RTMP", urls: [url] } }],
    },
    fetchImpl,
  );
  if (
    egressRoom(result) !== room ||
    typeof egressId(result) !== "string" ||
    !egressId(result)
  )
    throw new LiveAuthError(
      503,
      "LiveKit a peut-être démarré. Contrôlez l'état avant de réessayer.",
    );
  return { started: true, active: ACTIVE.has(result.status) };
}

export async function publishLivekitYoutube(
  env,
  clubId,
  channelId,
  videoId,
  fetchImpl = fetch,
) {
  const video = await getClubVideo(env, clubId, videoId, fetchImpl);
  const active = await activeEgress(
    env,
    livekitRoom(clubId, video.id),
    fetchImpl,
  );
  if (!active.some((e) => [1, "EGRESS_ACTIVE"].includes(e.status)))
    throw new LiveAuthError(
      409,
      "La sortie LiveKit n'est pas encore active. Vérifiez l'envoi caméra.",
    );
  if (active.some((e) => streamHealth(e).streamState === "failed"))
    throw new LiveAuthError(
      409,
      "La destination RTMP LiveKit est en échec. Arrêtez l'envoi et vérifiez le flux YouTube.",
    );
  const ingest = await loadYoutubeIngest(env, video.id, fetchImpl);
  const accessToken = await googleAccessToken(env, channelId, fetchImpl);
  const result = await publishVerifiedYoutubeLive(
    accessToken,
    video.youtube_video_id,
    ingest.youtube_stream_id,
    fetchImpl,
  );
  try {
    await synchronizeClubVideos(env, clubId, channelId, fetchImpl);
  } catch {
    // YouTube confirms publishing; catalogue can sync later.
  }
  return result;
}

async function stopRoomEgress(env, room, fetchImpl) {
  const active = await activeEgress(env, room, fetchImpl);
  for (const item of active) {
    const stopped = await twirp(
      env,
      "StopEgress",
      { egress_id: egressId(item) },
      fetchImpl,
    );
    if (egressId(stopped) !== egressId(item))
      throw new LiveAuthError(
        503,
        "LiveKit n'a pas confirmé la fin de l'envoi.",
      );
  }
  return { stopped: true };
}

/** Finish YouTube first (for replay), then stop RTMPS. */
export async function finishLivekitYoutube(
  env,
  clubId,
  channelId,
  videoId,
  fetchImpl = fetch,
) {
  const video = await getClubVideo(env, clubId, videoId, fetchImpl, true);
  const ingest = await loadYoutubeIngest(env, video.id, fetchImpl);
  const accessToken = await googleAccessToken(env, channelId, fetchImpl);
  await completeVerifiedYoutubeLive(
    accessToken,
    video.youtube_video_id,
    ingest.youtube_stream_id,
    fetchImpl,
  );
  await stopRoomEgress(env, livekitRoom(clubId, video.id), fetchImpl);
  try {
    await synchronizeClubVideos(env, clubId, channelId, fetchImpl);
  } catch {
    // YouTube already confirms complete; catalogue will catch up.
  }
  return { completed: true };
}

/** Abort an unpublished RTMP feed without touching the YouTube broadcast. */
export async function abortLivekitEgress(
  env,
  clubId,
  videoId,
  fetchImpl = fetch,
) {
  const video = await getClubVideo(env, clubId, videoId, fetchImpl);
  return stopRoomEgress(env, livekitRoom(clubId, video.id), fetchImpl);
}
