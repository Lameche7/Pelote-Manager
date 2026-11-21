import { LiveAuthError, required } from "./_live-google-shared.mjs";
import { privilegedHeaders } from "./_live-youtube-broadcast.mjs";
import { validateVideoId } from "./_live-youtube-ingest.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function getUpstreamBinding(
  env,
  clubId,
  videoId,
  fetchImpl = fetch,
) {
  const valid = validateVideoId(videoId);
  const params = new URLSearchParams({
    video_id: `eq.${valid}`,
    club_id: `eq.${clubId}`,
    select: "upstream_stream_id,upstream_destination_id",
    limit: "1",
  });
  const response = await fetchImpl(
    `${required(env, "VITE_SUPABASE_URL")}/rest/v1/pilotoki_live_upstream_bindings?${params}`,
    { headers: privilegedHeaders(env), cache: "no-store" },
  );
  if (!response.ok)
    throw new LiveAuthError(503, "Liaison caméra indisponible.");
  const rows = await response.json();
  return Array.isArray(rows) && rows.length
    ? {
        streamId: rows[0].upstream_stream_id,
        destinationConfigured: Boolean(rows[0].upstream_destination_id),
      }
    : null;
}

export async function getOwnedUpstreamStream(env, streamId, fetchImpl = fetch) {
  if (typeof streamId !== "string" || !UUID.test(streamId))
    throw new LiveAuthError(400, "Flux Upstream invalide.");
  const token = required(env, "UPSTREAM_API_TOKEN");
  let response;
  try {
    response = await fetchImpl(
      `https://studio.upstream.so/api/v1/streams/${streamId}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      },
    );
  } catch {
    throw new LiveAuthError(503, "Vérification Upstream indisponible.");
  }
  if (!response.ok)
    throw new LiveAuthError(409, "Ce flux Upstream n'est pas accessible.");
  const json = await response.json();
  const item = json?.data;
  if (item?.id !== streamId)
    throw new LiveAuthError(409, "Identité du flux Upstream incohérente.");
  const state = typeof item.status === "string" ? item.status : "unknown";
  if (state !== "paused")
    throw new LiveAuthError(
      409,
      "Arrêtez d'abord ce flux dans Upstream avant de l'associer.",
    );
  return { id: streamId, status: state };
}

export async function associateUpstreamStream(
  env,
  clubId,
  videoId,
  streamId,
  fetchImpl = fetch,
) {
  const id = validateVideoId(videoId);
  if (typeof streamId !== "string" || !UUID.test(streamId))
    throw new LiveAuthError(400, "Flux Upstream invalide.");
  // Verify the existing stream before persisting. No outbound stream control.
  await getOwnedUpstreamStream(env, streamId, fetchImpl);
  const base = required(env, "VITE_SUPABASE_URL");
  const params = new URLSearchParams({
    video_id: `eq.${id}`,
    club_id: `eq.${clubId}`,
    select: "upstream_stream_id",
    limit: "1",
  });
  const currentResponse = await fetchImpl(
    `${base}/rest/v1/pilotoki_live_upstream_bindings?${params}`,
    { headers: privilegedHeaders(env), cache: "no-store" },
  );
  if (!currentResponse.ok)
    throw new LiveAuthError(503, "Liaison existante indisponible.");
  const current = await currentResponse.json();
  if (Array.isArray(current) && current.length) {
    if (current[0].upstream_stream_id === streamId)
      return { streamId, alreadyLinked: true };
    throw new LiveAuthError(
      409,
      "Une autre régie est déjà associée à ce direct. Contactez l'administration pilote.",
    );
  }
  const response = await fetchImpl(
    `${base}/rest/v1/pilotoki_live_upstream_bindings`,
    {
      method: "POST",
      headers: {
        ...privilegedHeaders(env),
        "content-type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        video_id: id,
        club_id: clubId,
        upstream_stream_id: streamId,
      }),
      cache: "no-store",
    },
  );
  if (response.status === 409)
    throw new LiveAuthError(
      409,
      "Ce flux Upstream est déjà associé à une autre diffusion.",
    );
  if (!response.ok)
    throw new LiveAuthError(502, "Impossible d'enregistrer l'association.");
  return { streamId, alreadyLinked: false };
}
