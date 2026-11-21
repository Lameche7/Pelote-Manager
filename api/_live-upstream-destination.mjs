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
  if (binding.upstream_destination_id) {
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
        "La destination enregistrée a été modifiée. Contrôle manuel requis.",
      );
    return { configured: true, alreadyConfigured: true };
  }
  if (destinations.some((d) => d.url === video.youtube_video_id))
    throw new LiveAuthError(
      409,
      "Une destination pour cette vidéo existe déjà dans Upstream. Vérifiez-la avant de réessayer.",
    );
  if (destinations.length >= 10)
    throw new LiveAuthError(
      409,
      "Limite de dix destinations Upstream atteinte.",
    );

  const ingest = await loadYoutubeIngest(env, video.id, fetchImpl);
  const key = decryptYoutubeIngest(env, ingest);
  // Never modify existing destinations. A new destination stays PAUSED until
  // another explicit, separately authorized action enables it.
  const name = `Pilotoki - ${video.title}`.slice(0, 100);
  let created;
  try {
    created = await fetchImpl(`${UPSTREAM}/${streamId}/destinations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${required(env, "UPSTREAM_API_FULL_TOKEN")}`,
        "content-type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        name,
        platform: "custom",
        key,
        status: "paused",
        include_in_schedule: false,
        url: video.youtube_video_id,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new LiveAuthError(
      503,
      "Réponse Upstream incertaine : contrôlez les destinations avant de réessayer.",
    );
  }
  if (created.status !== 201) {
    // Do not forward the provider response body: it could contain an RTMP
    // secret, a request echo, or user-controlled text.
    let issue = "";
    if (created.status === 400 || created.status === 422) {
      try {
        const provider = await created.json();
        const fields = Object.keys(
          provider?.errors && typeof provider.errors === "object"
            ? provider.errors
            : {},
        ).filter((field) =>
          [
            "key",
            "name",
            "platform",
            "status",
            "url",
            "include_in_schedule",
          ].includes(field),
        );
        if (fields.length) issue = ` Champs concernés : ${fields.join(", ")}.`;
      } catch {
        // An unreadable provider response is intentionally not exposed.
      }
    }
    const known = {
      400: "Paramètres refusés",
      401: "Clé API Upstream non reconnue",
      402: "Limite du forfait Upstream",
      403: "Droits de la clé Upstream insuffisants",
      404: "Régie Upstream introuvable",
      409: "Conflit de destination ou de quota",
      422: "Données de destination invalides",
      429: "Trop de requêtes Upstream",
    };
    const reason = known[created.status] ?? "Refus Upstream";
    throw new LiveAuthError(
      502,
      `Création de destination refusée par Upstream (HTTP ${created.status} : ${reason}).${issue}`,
    );
  }
  const payload = await created.json();
  const destinationId = payload?.data?.id;
  if (!UUID.test(destinationId ?? ""))
    throw new LiveAuthError(
      502,
      "Destination créée mais réponse Upstream invalide : vérification manuelle requise.",
    );

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
