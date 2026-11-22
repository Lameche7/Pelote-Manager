import { LiveAuthError, required } from "./_live-google-shared.mjs";
import { privilegedHeaders } from "./_live-youtube-broadcast.mjs";
import { getOwnedUpstreamStream } from "./_live-upstream-binding.mjs";
import {
  decryptYoutubeIngest,
  loadYoutubeIngest,
} from "./_live-upstream-destination.mjs";
import { assertYoutubeBroadcastComplete } from "./_live-youtube-publish.mjs";

const STREAMS = "https://studio.upstream.so/api/v1/streams";

async function inspect(env, path, fetchImpl) {
  const response = await fetchImpl(`${STREAMS}/${path}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${required(env, "UPSTREAM_API_TOKEN")}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok)
    throw new LiveAuthError(503, "État de la régie indisponible.");
  return (await response.json())?.data;
}

/**
 * Reuse the ONE existing, stopped club studio after the old broadcast
 * has been archived. A partial provider write always fails closed.
 */
export async function reuseIdleUpstreamForVideo(
  env,
  clubId,
  newVideo,
  accessToken,
  fetchImpl = fetch,
) {
  if (newVideo.status !== "scheduled")
    throw new LiveAuthError(409, "Seul un direct programmé peut être préparé.");
  const base = required(env, "VITE_SUPABASE_URL");
  const bindingUrl = `${base}/rest/v1/pilotoki_live_upstream_bindings`;
  const entries = await fetchImpl(
    `${bindingUrl}?${new URLSearchParams({
      club_id: `eq.${clubId}`,
      select: "video_id,upstream_stream_id,upstream_destination_id",
      limit: "3",
    })}`,
    { headers: privilegedHeaders(env), cache: "no-store" },
  );
  if (!entries.ok)
    throw new LiveAuthError(503, "Association des régies indisponible.");
  const bindings = await entries.json();
  if (!Array.isArray(bindings) || bindings.length !== 1)
    throw new LiveAuthError(
      409,
      "Aucune régie unique réutilisable n'a été trouvée pour ce club.",
    );
  const previous = bindings[0];
  if (previous.video_id === newVideo.id)
    throw new LiveAuthError(
      409,
      "Ce direct possède déjà une régie. Actualisez sa préparation.",
    );
  if (previous.upstream_destination_id !== previous.upstream_stream_id)
    throw new LiveAuthError(
      409,
      "Cette régie n'utilise pas la destination principale Pilotoki.",
    );
  const previousResponse = await fetchImpl(
    `${base}/rest/v1/pilotoki_live_videos?${new URLSearchParams({
      id: `eq.${previous.video_id}`,
      club_id: `eq.${clubId}`,
      status: "eq.replay",
      select: "id,youtube_video_id",
      limit: "1",
    })}`,
    { headers: privilegedHeaders(env), cache: "no-store" },
  );
  if (!previousResponse.ok)
    throw new LiveAuthError(503, "Ancienne vidéo indisponible.");
  const oldVideo = (await previousResponse.json())?.[0];
  if (!oldVideo)
    throw new LiveAuthError(
      409,
      "La vidéo précédente n'est pas encore archivée en replay.",
    );
  await assertYoutubeBroadcastComplete(
    accessToken,
    oldVideo.youtube_video_id,
    fetchImpl,
  );
  await getOwnedUpstreamStream(env, previous.upstream_stream_id, fetchImpl);
  const [stream, destinations] = await Promise.all([
    inspect(env, previous.upstream_stream_id, fetchImpl),
    inspect(env, `${previous.upstream_stream_id}/destinations`, fetchImpl),
  ]);
  if (
    stream?.id !== previous.upstream_stream_id ||
    stream?.status !== "paused" ||
    stream.platform !== "youtube" ||
    stream.url !== oldVideo.youtube_video_id ||
    !Array.isArray(destinations) ||
    destinations.length !== 0
  )
    throw new LiveAuthError(
      409,
      "La régie a changé ou contient une autre destination. Contrôle manuel nécessaire.",
    );

  const ingest = await loadYoutubeIngest(env, newVideo.id, fetchImpl);
  const ingestUrl = decryptYoutubeIngest(env, ingest);
  const key = ingestUrl.substring(ingestUrl.lastIndexOf("/") + 1);
  let updated;
  try {
    updated = await fetchImpl(`${STREAMS}/${previous.upstream_stream_id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${required(env, "UPSTREAM_API_FULL_TOKEN")}`,
        Accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        platform: "youtube",
        key,
        url: newVideo.youtube_video_id,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new LiveAuthError(
      503,
      "La destination a peut-être changé : vérifiez Upstream avant toute nouvelle action.",
    );
  }
  if (!updated.ok)
    throw new LiveAuthError(
      502,
      `Réaffectation de la régie refusée par Upstream (HTTP ${updated.status}).`,
    );

  const verified = await inspect(env, previous.upstream_stream_id, fetchImpl);
  if (
    verified?.id !== previous.upstream_stream_id ||
    verified?.platform !== "youtube" ||
    verified?.url !== newVideo.youtube_video_id ||
    verified?.status !== "paused"
  )
    throw new LiveAuthError(
      409,
      "La nouvelle destination n'est pas confirmée. Ne démarrez pas la régie.",
    );

  const saved = await fetchImpl(
    `${bindingUrl}?${new URLSearchParams({
      video_id: `eq.${oldVideo.id}`,
      club_id: `eq.${clubId}`,
      upstream_stream_id: `eq.${previous.upstream_stream_id}`,
    })}`,
    {
      method: "PATCH",
      headers: {
        ...privilegedHeaders(env),
        "content-type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ video_id: newVideo.id }),
      cache: "no-store",
    },
  );
  if (!saved.ok || (await saved.json())?.[0]?.video_id !== newVideo.id)
    throw new LiveAuthError(
      503,
      "Upstream est configuré, mais l'association a échoué. Vérification manuelle nécessaire.",
    );
  return { configured: true, reused: true };
}
