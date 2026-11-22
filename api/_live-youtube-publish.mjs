import { LiveAuthError } from "./_live-google-shared.mjs";

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const STREAM_ID = /^[A-Za-z0-9_-]{1,128}$/;
const YOUTUBE = "https://www.googleapis.com/youtube/v3";

async function youtubeRead(accessToken, resource, params, fetchImpl) {
  const response = await fetchImpl(`${YOUTUBE}/${resource}?${params}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok)
    throw new LiveAuthError(
      502,
      "Vérification du direct YouTube indisponible.",
    );
  const payload = await response.json();
  if (!Array.isArray(payload?.items) || payload.items.length !== 1)
    throw new LiveAuthError(409, "Identité du direct YouTube non vérifiable.");
  return payload.items[0];
}

/** Publish only a matching, verified broadcast with an ACTIVE YouTube ingest. */
export async function publishVerifiedYoutubeLive(
  accessToken,
  videoId,
  streamId,
  fetchImpl = fetch,
) {
  if (!YOUTUBE_ID.test(videoId) || !STREAM_ID.test(streamId))
    throw new LiveAuthError(400, "Identifiants YouTube invalides.");
  const broadcast = await youtubeRead(
    accessToken,
    "liveBroadcasts",
    new URLSearchParams({
      part: "status,contentDetails",
      id: videoId,
    }),
    fetchImpl,
  );
  if (
    broadcast.id !== videoId ||
    broadcast.contentDetails?.boundStreamId !== streamId
  )
    throw new LiveAuthError(
      409,
      "Le direct YouTube n'est pas lié au flux vidéo attendu.",
    );
  if (!["public", "unlisted"].includes(broadcast.status?.privacyStatus))
    throw new LiveAuthError(409, "Cette vidéo YouTube n'est pas publiable.");
  if (broadcast.status?.lifeCycleStatus === "live")
    return { status: "live", alreadyLive: true };
  if (!["ready", "testing"].includes(broadcast.status?.lifeCycleStatus))
    throw new LiveAuthError(
      409,
      "Ce direct YouTube n'est pas prêt pour sa mise en ligne.",
    );
  const stream = await youtubeRead(
    accessToken,
    "liveStreams",
    new URLSearchParams({ part: "status", id: streamId }),
    fetchImpl,
  );
  if (stream.id !== streamId || stream.status?.streamStatus !== "active")
    throw new LiveAuthError(
      409,
      "YouTube n'a pas encore reçu le signal vidéo et audio. Vérifiez la caméra avant de lancer le direct.",
    );
  const params = new URLSearchParams({
    broadcastStatus: "live",
    id: videoId,
    part: "status",
  });
  const transitioned = await fetchImpl(
    `${YOUTUBE}/liveBroadcasts/transition?${params}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!transitioned.ok)
    throw new LiveAuthError(
      502,
      "YouTube n'a pas confirmé le lancement. Vérifiez son état avant de réessayer.",
    );
  const result = await transitioned.json();
  if (
    result?.id !== videoId ||
    !["live", "liveStarting"].includes(result?.status?.lifeCycleStatus)
  )
    throw new LiveAuthError(
      503,
      "État du direct incertain après la commande YouTube : vérification nécessaire.",
    );
  return {
    status: result.status.lifeCycleStatus,
    alreadyLive: false,
  };
}
