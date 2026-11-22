// Only server-side code can decrypt RTMPS credentials or write Upstream destinations.
import { createDecipheriv } from "node:crypto";
import { LiveAuthError, required } from "./_live-google-shared.mjs";
import { privilegedHeaders } from "./_live-youtube-broadcast.mjs";
import { getOwnedUpstreamStream } from "./_live-upstream-binding.mjs";
import { validateVideoId } from "./_live-youtube-ingest.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const UPSTREAM = "https://studio.upstream.so/api/v1/streams";

export function decryptYoutubeIngest(env, record) {
  if (
    typeof record?.ingest_ciphertext !== "string" ||
    typeof record?.ingest_iv !== "string"
  )
    throw new LiveAuthError(409, "Le flux YouTube n'est pas encore préparé.");
  try {
    const key = Buffer.from(
      required(env, "YOUTUBE_TOKEN_ENCRYPTION_KEY"),
      "base64",
    );
    if (key.length !== 32) throw new Error("key size");
    const bytes = Buffer.from(record.ingest_ciphertext, "base64");
    if (bytes.length < 17) throw new Error("ciphertext");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(record.ingest_iv, "base64"),
    );
    decipher.setAuthTag(bytes.subarray(-16));
    const credentials = JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(0, -16)),
        decipher.final(),
      ]).toString("utf8"),
    );
    // Only the official RTMPS ingest host is allowed. Never send secrets to an
    // arbitrary URL, even if the encrypted record becomes corrupted.
    const target = new URL(credentials.address);
    if (
      target.protocol !== "rtmps:" ||
      !["a.rtmps.youtube.com", "b.rtmps.youtube.com"].includes(
        target.hostname,
      ) ||
      target.username ||
      target.password ||
      target.search ||
      target.hash ||
      !/^\/live2\/?$/.test(target.pathname) ||
      typeof credentials.streamName !== "string" ||
      !/^[A-Za-z0-9_-]{1,200}$/.test(credentials.streamName)
    )
      throw new Error("ingest credentials");
    return `${target.protocol}//${target.host}${target.pathname.replace(/\/$/, "")}/${credentials.streamName}`;
  } catch {
    throw new LiveAuthError(
      503,
      "Identifiants YouTube illisibles ou invalides.",
    );
  }
}

export async function loadYoutubeIngest(env, videoId, fetchImpl = fetch) {
  const params = new URLSearchParams({
    video_id: `eq.${validateVideoId(videoId)}`,
    select: "youtube_stream_id,ingest_ciphertext,ingest_iv",
    limit: "1",
  });
  const response = await fetchImpl(
    `${required(env, "VITE_SUPABASE_URL")}/rest/v1/pilotoki_live_ingest_credentials?${params}`,
    { headers: privilegedHeaders(env), cache: "no-store" },
  );
  if (!response.ok) throw new LiveAuthError(503, "Flux YouTube indisponible.");
  const rows = await response.json();
  if (!rows?.[0])
    throw new LiveAuthError(
      409,
      "Préparez d'abord le flux YouTube de ce direct.",
    );
  return rows[0];
}

async function listDestinations(env, streamId, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${UPSTREAM}/${streamId}/destinations`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${required(env, "UPSTREAM_API_TOKEN")}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new LiveAuthError(
      503,
      "Lecture des destinations Upstream indisponible.",
    );
  }
  if (!response.ok)
    throw new LiveAuthError(503, "Destinations Upstream indisponibles.");
  const value = await response.json();
  if (!Array.isArray(value?.data))
    throw new LiveAuthError(503, "Réponse Upstream invalide.");
  return value.data;
}

export async function prepareUpstreamYoutubeDestination(
  env,
  clubId,
  video,
  fetchImpl = fetch,
) {
  if (
    video.status !== "scheduled" ||
    !YOUTUBE_ID.test(video.youtube_video_id ?? "")
  )
    throw new LiveAuthError(
      409,
      "Seul un direct YouTube programmé peut être préparé.",
    );

  const params = new URLSearchParams({
    video_id: `eq.${validateVideoId(video.id)}`,
    club_id: `eq.${clubId}`,
    select: "upstream_stream_id,upstream_destination_id",
    limit: "1",
  });
  const supabaseUrl = `${required(env, "VITE_SUPABASE_URL")}/rest/v1/pilotoki_live_upstream_bindings`;
  const boundResponse = await fetchImpl(`${supabaseUrl}?${params}`, {
    headers: privilegedHeaders(env),
    cache: "no-store",
  });
  if (!boundResponse.ok)
    throw new LiveAuthError(503, "Association Upstream indisponible.");
  const bindings = await boundResponse.json();
  const binding = bindings?.[0];
  if (!UUID.test(binding?.upstream_stream_id ?? ""))
    throw new LiveAuthError(
      409,
      "Associez d'abord une régie Upstream à ce direct.",
    );
  const streamId = binding.upstream_stream_id;
  await getOwnedUpstreamStream(env, streamId, fetchImpl);
  const destinations = await listDestinations(env, streamId, fetchImpl);
  // The /destinations endpoint only accepts SECONDARY outputs. The primary
  // destination must be configured directly on a dedicated Upstream stream.
  const primaryResponse = await fetchImpl(`${UPSTREAM}/${streamId}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${required(env, "UPSTREAM_API_TOKEN")}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!primaryResponse.ok)
    throw new LiveAuthError(503, "Destination principale Upstream non vérifiable.");
  const primary = (await primaryResponse.json())?.data;
  if (primary?.id !== streamId)
    throw new LiveAuthError(503, "Identité de la régie Upstream non vérifiable.");
  // The stream UUID is an explicit sentinel for a verified PRIMARY output.
  // Secondary destination UUIDs from older mappings are never rewritten.
  if (binding.upstream_destination_id) {
    if (binding.upstream_destination_id === streamId) {
      if (
        primary.platform !== "youtube" ||
        primary.url !== video.youtube_video_id ||
        destinations.length !== 0
      )
        throw new LiveAuthError(
          409,
          "La destination principale YouTube a changé : vérification manuelle nécessaire.",
        );
      return { configured: true, alreadyConfigured: true };
    }
    const dest = destinations.find(
      (d) => d.id === binding.upstream_destination_id,
    );
    if (
      !dest ||
      dest.url !== video.youtube_video_id ||
      dest.status !== "paused"
    )
      throw new LiveAuthError(
        409,
        "La destination secondaire enregistrée a été modifiée. Contrôle manuel requis.",
      );
    return { configured: true, alreadyConfigured: true };
  }
  // Never replace an existing primary, not even if it claims the same video:
  // its secret key is write-only and cannot be verified by a GET request.
  if (primary.platform !== "none" || destinations.length > 0)
    throw new LiveAuthError(
      409,
      "Cette régie possède déjà une destination. Utilisez une régie dédiée sans destination principale ni secondaire, pour ne pas écraser un autre direct.",
    );

  const ingest = await loadYoutubeIngest(env, video.id, fetchImpl);
  const ingestUrl = decryptYoutubeIngest(env, ingest);
  // Upstream expects the stream key alone for its native YouTube destination.
  // A full rtmps:// URL is valid only for platform=custom.
  const key = ingestUrl.substring(ingestUrl.lastIndexOf("/") + 1);
  // Updating a PAUSED, empty primary does not start broadcasting.
  // The operator must explicitly start Upstream and YouTube afterwards.
  let created;
  try {
    created = await fetchImpl(`${UPSTREAM}/${streamId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${required(env, "UPSTREAM_API_FULL_TOKEN")}`,
        "content-type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        platform: "youtube",
        key,
        url: video.youtube_video_id,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new LiveAuthError(
      503,
      "Réponse incertaine après configuration de la destination principale : contrôlez Upstream avant de réessayer.",
    );
  }
  if (!created.ok)
    throw new LiveAuthError(
      502,
      `Configuration de la destination principale refusée par Upstream (HTTP ${created.status}).`,
    );
  // Verify the public ID after writing the (write-only) stream key.
  const verifyResponse = await fetchImpl(`${UPSTREAM}/${streamId}`, {
    headers: {
      Authorization: `Bearer ${required(env, "UPSTREAM_API_TOKEN")}`,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!verifyResponse.ok)
    throw new LiveAuthError(
      503,
      "Destination principale modifiée, mais vérification impossible. Contrôle manuel nécessaire.",
    );
  const updated = (await verifyResponse.json())?.data;
  if (
    updated?.id !== streamId ||
    updated.platform !== "youtube" ||
    updated.url !== video.youtube_video_id ||
    updated.status !== "paused"
  )
    throw new LiveAuthError(
      409,
      "Destination principale modifiée, mais non vérifiable. Contrôle manuel nécessaire avant tout direct.",
    );
  const destinationId = streamId;
  const saveParams = new URLSearchParams({
    video_id: `eq.${video.id}`,
    club_id: `eq.${clubId}`,
    upstream_stream_id: `eq.${streamId}`,
    upstream_destination_id: "is.null",
    select: "video_id",
  });
  const saved = await fetchImpl(`${supabaseUrl}?${saveParams}`, {
    method: "PATCH",
    headers: {
      ...privilegedHeaders(env),
      "content-type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ upstream_destination_id: destinationId }),
    cache: "no-store",
  });
  if (!saved.ok)
    throw new LiveAuthError(
      503,
      "Destination créée en pause, mais sauvegarde incomplète : contactez l'administration.",
    );
  const savedRows = await saved.json();
  if (!Array.isArray(savedRows) || savedRows.length !== 1)
    throw new LiveAuthError(
      409,
      "Destination créée en pause ; association concurrente détectée. Contrôle manuel nécessaire.",
    );
  return { configured: true, alreadyConfigured: false };
}
