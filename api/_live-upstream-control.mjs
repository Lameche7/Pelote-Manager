import { LiveAuthError, required } from "./_live-google-shared.mjs";
import { privilegedHeaders } from "./_live-youtube-broadcast.mjs";
import { validateVideoId } from "./_live-youtube-ingest.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE = "https://studio.upstream.so/api/v1/streams";
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export async function loadControlBinding(
  env,
  clubId,
  videoId,
  fetchImpl = fetch,
) {
  const base = required(env, "VITE_SUPABASE_URL");
  const id = validateVideoId(videoId);
  const params = new URLSearchParams({
    id: `eq.${id}`,
    club_id: `eq.${clubId}`,
    select: "id,youtube_video_id,title,status",
    limit: "1",
  });
  const videoResponse = await fetchImpl(
    `${base}/rest/v1/pilotoki_live_videos?${params}`,
    {
      headers: privilegedHeaders(env),
      cache: "no-store",
    },
  );
  if (!videoResponse.ok)
    throw new LiveAuthError(503, "Vidéo Pilotoki indisponible.");
  const video = (await videoResponse.json())?.[0];
  if (
    !video ||
    !["scheduled", "live"].includes(video.status) ||
    !YOUTUBE_ID.test(video.youtube_video_id ?? "")
  )
    throw new LiveAuthError(404, "Direct Pilotoki introuvable ou terminé.");
  const bindingParams = new URLSearchParams({
    video_id: `eq.${id}`,
    club_id: `eq.${clubId}`,
    select: "upstream_stream_id,upstream_destination_id",
    limit: "1",
  });
  const bindingResponse = await fetchImpl(
    `${base}/rest/v1/pilotoki_live_upstream_bindings?${bindingParams}`,
    {
      headers: privilegedHeaders(env),
      cache: "no-store",
    },
  );
  if (!bindingResponse.ok)
    throw new LiveAuthError(503, "Liaison Upstream indisponible.");
  const binding = (await bindingResponse.json())?.[0];
  if (
    !UUID.test(binding?.upstream_stream_id ?? "") ||
    !UUID.test(binding?.upstream_destination_id ?? "")
  )
    throw new LiveAuthError(
      409,
      "Préparez d'abord la destination YouTube de ce direct.",
    );
  return {
    streamId: binding.upstream_stream_id,
    destinationId: binding.upstream_destination_id,
    youtubeId: video.youtube_video_id,
    videoTitle: video.title,
  };
}

async function upstreamGet(env, path, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${BASE}/${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${required(env, "UPSTREAM_API_TOKEN")}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new LiveAuthError(503, "Vérification du flux Upstream indisponible.");
  }
  if (!response.ok)
    throw new LiveAuthError(503, "Impossible de vérifier Upstream.");
  try {
    return (await response.json())?.data;
  } catch {
    throw new LiveAuthError(503, "Réponse Upstream invalide.");
  }
}

export async function inspectUpstreamControl(
  env,
  clubId,
  videoId,
  fetchImpl = fetch,
) {
  const binding = await loadControlBinding(env, clubId, videoId, fetchImpl);
  const [stream, destinations] = await Promise.all([
    upstreamGet(env, binding.streamId, fetchImpl),
    upstreamGet(env, `${binding.streamId}/destinations`, fetchImpl),
  ]);
  if (stream?.id !== binding.streamId || !Array.isArray(destinations))
    throw new LiveAuthError(503, "Identité Upstream non vérifiable.");
  const target = destinations.find(
    (item) => item?.id === binding.destinationId,
  );
  const otherActive = destinations.some(
    (item) => item.id !== binding.destinationId && item.status !== "paused",
  );
  let reason = null;
  // The existing "Test Lourdes Trinquet" stream still has a primary YouTube
  // destination. Starting it could broadcast to the WRONG YouTube event.
  // Do not guess how primary destinations are muted. Require platform=none.
  if (stream.platform !== "none")
    reason =
      "Cette régie possède encore une destination principale. Pour éviter de diffuser vers un ancien direct, utilisez une régie dédiée sans destination principale.";
  else if (
    !target ||
    target.url !== binding.youtubeId ||
    target.platform !== "custom"
  )
    reason = "La destination YouTube liée à ce direct n'est plus vérifiable.";
  else if (otherActive)
    reason =
      "Une autre destination est activée. Désactivez-la dans Upstream avant le pilotage Pilotoki.";
  else if (!["paused", "active", "booting"].includes(stream.status))
    reason = "L'état actuel de la régie n'autorise pas ce pilotage.";
  const safe = !reason;
  return {
    safe,
    reason,
    streamStatus: typeof stream.status === "string" ? stream.status : "unknown",
    destinationStatus:
      target?.status === "active"
        ? "active"
        : target?.status === "paused"
          ? "paused"
          : "unknown",
    canStart: safe && stream.status === "paused" && target.status === "paused",
    canStop:
      safe &&
      ["active", "booting"].includes(stream.status) &&
      target.status === "active",
    // Server-only for command usage. Never serialize this internal binding to browser.
    _binding: binding,
  };
}

async function command(env, path, method, body, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${BASE}/${path}`, {
      method,
      headers: {
        Accept: "application/json",
        "content-type": "application/json",
        Authorization: `Bearer ${required(env, "UPSTREAM_API_FULL_TOKEN")}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new LiveAuthError(
      503,
      "Réponse Upstream incertaine. Vérifiez son état avant toute nouvelle action.",
    );
  }
  if (!response.ok)
    throw new LiveAuthError(
      502,
      "Commande Upstream refusée. Vérifiez la régie.",
    );
  return response;
}

export async function controlUpstreamStream(
  env,
  clubId,
  videoId,
  action,
  fetchImpl = fetch,
) {
  if (!["start", "stop"].includes(action))
    throw new LiveAuthError(400, "Commande de diffusion invalide.");
  const status = await inspectUpstreamControl(env, clubId, videoId, fetchImpl);
  if (!status.safe || (action === "start" ? !status.canStart : !status.canStop))
    throw new LiveAuthError(
      409,
      status.reason || "État du direct incompatible avec la commande demandée.",
    );
  const { streamId, destinationId } = status._binding;
  if (action === "start") {
    // Activating only the bound destination; primary must be platform=none
    // and every other destination paused.
    await command(
      env,
      `${streamId}/destinations/${destinationId}`,
      "PATCH",
      { status: "active" },
      fetchImpl,
    );
    try {
      await command(env, `${streamId}/start`, "POST", null, fetchImpl);
    } catch {
      // Best-effort compensation; if this fails, operator must inspect Upstream.
      try {
        await command(
          env,
          `${streamId}/destinations/${destinationId}`,
          "PATCH",
          { status: "paused" },
          fetchImpl,
        );
      } catch {
        // Do not hide the original uncertainty.
      }
      throw new LiveAuthError(
        503,
        "Démarrage non confirmé. Vérifiez Upstream avant toute autre action.",
      );
    }
  } else {
    await command(env, `${streamId}/stop`, "POST", null, fetchImpl);
    await command(
      env,
      `${streamId}/destinations/${destinationId}`,
      "PATCH",
      { status: "paused" },
      fetchImpl,
    );
  }
  return { action, requested: true };
}

export function publicControlStatus(status) {
  const { safe, reason, streamStatus, destinationStatus, canStart, canStop } =
    status;
  return { safe, reason, streamStatus, destinationStatus, canStart, canStop };
}
