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
  if (["live", "liveStarting"].includes(broadcast.status?.lifeCycleStatus))
    return { status: broadcast.status.lifeCycleStatus, alreadyLive: true };
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
  if (!transitioned.ok) {
    // YouTube auto-start may win the race against our explicit transition.
    // Never report failure until the exact bound broadcast is checked again.
    const latest = await youtubeRead(
      accessToken,
      "liveBroadcasts",
      new URLSearchParams({ part: "status,contentDetails", id: videoId }),
      fetchImpl,
    );
    if (
      latest.id === videoId &&
      latest.contentDetails?.boundStreamId === streamId &&
      ["live", "liveStarting"].includes(latest.status?.lifeCycleStatus)
    )
      return { status: latest.status.lifeCycleStatus, alreadyLive: true };
    throw new LiveAuthError(
      502,
      "YouTube n'a pas confirmé le lancement. Vérifiez son état avant de réessayer.",
    );
  }
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

/** Explicitly end a matching broadcast; never complete a different video. */
export async function completeVerifiedYoutubeLive(
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
    new URLSearchParams({ part: "status,contentDetails", id: videoId }),
    fetchImpl,
  );
  if (
    broadcast.id !== videoId ||
    broadcast.contentDetails?.boundStreamId !== streamId
  )
    throw new LiveAuthError(
      409,
      "Le direct YouTube ne correspond pas au flux Pilotoki.",
    );
  if (broadcast.status?.lifeCycleStatus === "complete")
    return { status: "complete", alreadyComplete: true };
  if (broadcast.status?.lifeCycleStatus !== "live")
    throw new LiveAuthError(
      409,
      "YouTube ne confirme pas un direct en cours. Vérifiez son état.",
    );
  const response = await fetchImpl(
    `${YOUTUBE}/liveBroadcasts/transition?${new URLSearchParams({
      broadcastStatus: "complete",
      id: videoId,
      part: "status",
    })}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw new LiveAuthError(
      503,
      "La fin du direct YouTube n'est pas confirmée. Vérifiez avant de réessayer.",
    );
  const result = await response.json();
  if (result?.id !== videoId || result.status?.lifeCycleStatus !== "complete")
    throw new LiveAuthError(
      503,
      "État YouTube incertain après la demande de fin de direct.",
    );
  return { status: "complete", alreadyComplete: false };
}

/** Check that YouTube really archived a previous broadcast before rotating. */
export async function assertYoutubeBroadcastComplete(
  accessToken,
  videoId,
  fetchImpl = fetch,
) {
  if (!YOUTUBE_ID.test(videoId))
    throw new LiveAuthError(400, "Ancien direct invalide.");
  const item = await youtubeRead(
    accessToken,
    "liveBroadcasts",
    new URLSearchParams({ part: "status", id: videoId }),
    fetchImpl,
  );
  if (item.id !== videoId || item.status?.lifeCycleStatus !== "complete")
    throw new LiveAuthError(
      409,
      "Terminez d'abord la précédente vidéo sur YouTube avant de réutiliser cette régie.",
    );
}
