// Server-only YouTube broadcast preparation. Do not expose OAuth or ingest secrets.
import { createDecipheriv } from "node:crypto";
import { LiveAuthError, required } from "./_live-google-shared.mjs";

export function privilegedHeaders(env) {
  const key = required(env, "SUPABASE_SERVICE_ROLE_KEY");
  return {
    apikey: key,
    ...(key.startsWith("sb_secret_") ? {} : { authorization: `Bearer ${key}` }),
  };
}

export async function verifiedLiveClubAdmin(request, env, fetchImpl = fetch) {
  const url = required(env, "VITE_SUPABASE_URL");
  const anonKey = required(env, "VITE_SUPABASE_ANON_KEY");
  const bearer = request.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
  if (!bearer) throw new LiveAuthError(401, "Connectez-vous à Pilotoki.");
  const headers = { apikey: anonKey, authorization: `Bearer ${bearer}` };
  const userResponse = await fetchImpl(`${url}/auth/v1/user`, {
    headers,
    cache: "no-store",
  });
  if (!userResponse.ok) throw new LiveAuthError(401, "Session expirée.");
  const user = await userResponse.json();
  if (!/^[0-9a-f-]{36}$/i.test(user?.id ?? ""))
    throw new LiveAuthError(401, "Compte invalide.");

  // The RPC checks membership + settings.manage for the active club.
  const settingsResponse = await fetchImpl(
    `${url}/rest/v1/rpc/admin_get_club_live_settings`,
    {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: "{}",
      cache: "no-store",
    },
  );
  if (!settingsResponse.ok)
    throw new LiveAuthError(
      403,
      "Gestion des directs non autorisée pour ce club.",
    );
  const settings = await settingsResponse.json();
  if (!/^[0-9a-f-]{36}$/i.test(settings?.club_id ?? ""))
    throw new LiveAuthError(403, "Club actif invalide.");
  if (settings.connection_status !== "connected")
    throw new LiveAuthError(
      409,
      "La chaîne Pilotoki n'est pas connectée à Google.",
    );
  return {
    clubId: settings.club_id,
    channelId: settings.youtube_channel_id,
    canConnectGoogle: settings.can_connect_google === true,
  };
}

export function decryptRefreshToken(env, record) {
  if (!record?.refresh_token_ciphertext || !record?.refresh_token_iv)
    throw new LiveAuthError(503, "Connexion Google absente.");
  const key = Buffer.from(
    required(env, "YOUTUBE_TOKEN_ENCRYPTION_KEY"),
    "base64",
  );
  if (key.length !== 32)
    throw new LiveAuthError(503, "Clé de chiffrement invalide.");
  try {
    const bytes = Buffer.from(record.refresh_token_ciphertext, "base64");
    if (bytes.length < 17) throw new Error("Bad ciphertext");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(record.refresh_token_iv, "base64"),
    );
    decipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([
      decipher.update(bytes.subarray(0, -16)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new LiveAuthError(
      503,
      "Autorisation Google illisible. Reconnectez la chaîne.",
    );
  }
}

export async function googleAccessToken(env, channelId, fetchImpl = fetch) {
  const url = required(env, "VITE_SUPABASE_URL");
  const response = await fetchImpl(
    `${url}/rest/v1/pilotoki_live_google_credentials?id=eq.true&select=channel_id,refresh_token_ciphertext,refresh_token_iv`,
    {
      headers: privilegedHeaders(env),
      cache: "no-store",
    },
  );
  if (!response.ok)
    throw new LiveAuthError(503, "Connexion Google indisponible.");
  const records = await response.json();
  const record = records?.[0];
  if (record?.channel_id !== channelId)
    throw new LiveAuthError(409, "La chaîne YouTube configurée a changé.");
  const refreshToken = decryptRefreshToken(env, record);
  const tokensResponse = await fetchImpl(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: required(env, "YOUTUBE_OAUTH_CLIENT_ID"),
        client_secret: required(env, "YOUTUBE_OAUTH_CLIENT_SECRET"),
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
      cache: "no-store",
    },
  );
  if (!tokensResponse.ok)
    throw new LiveAuthError(
      503,
      "L'autorisation YouTube a expiré. Reconnectez Google à Pilotoki Live.",
    );
  const tokens = await tokensResponse.json();
  if (typeof tokens?.access_token !== "string")
    throw new LiveAuthError(503, "Accès YouTube indisponible.");
  return tokens.access_token;
}

export function validateBroadcastInput(payload, now = Date.now()) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new LiveAuthError(400, "Formulaire invalide.");
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  if (title.length < 5 || title.length > 100)
    throw new LiveAuthError(
      400,
      "Le titre doit contenir entre 5 et 100 caractères.",
    );
  if (payload.consentConfirmed !== true)
    throw new LiveAuthError(
      400,
      "Confirmez les autorisations de captation et de diffusion.",
    );
  if (typeof payload.madeForKids !== "boolean")
    throw new LiveAuthError(
      400,
      "Précisez si le direct est destiné aux enfants.",
    );
  const type = payload.sourceType;
  if (!["tournoi", "championnat", "other"].includes(type))
    throw new LiveAuthError(400, "Type de rencontre invalide.");
  const sourceId = payload.sourceId ?? null;
  // A match association requires a separate authorization check against the club.
  // Until then, reject arbitrary source IDs rather than enabling cross-club references.
  if (sourceId !== null)
    throw new LiveAuthError(
      400,
      "Le rattachement automatique à une rencontre sera disponible prochainement.",
    );
  const scheduled = new Date(payload.scheduledStartTime);
  if (
    !Number.isFinite(scheduled.getTime()) ||
    scheduled.getTime() < now + 60_000 ||
    scheduled.getTime() > now + 90 * 24 * 60 * 60_000
  )
    throw new LiveAuthError(
      400,
      "Choisissez une date future dans les 90 prochains jours.",
    );
  return {
    title,
    sourceType: type,
    sourceId,
    scheduledStartTime: scheduled.toISOString(),
    madeForKids: payload.madeForKids,
  };
}

// Only return allowlisted YouTube error reasons. Never relay raw third-party
// messages, tokens, request metadata, or arbitrary response fields.
const YOUTUBE_BROADCAST_ERRORS = Object.freeze({
  liveStreamingNotEnabled:
    "La chaîne YouTube n'est pas activée pour la diffusion en direct. Vérifiez YouTube Studio.",
  insufficientLivePermissions:
    "Le compte Google n'a pas les droits nécessaires pour créer un direct sur cette chaîne.",
  livePermissionBlocked:
    "YouTube bloque actuellement la diffusion en direct sur cette chaîne.",
  invalidScheduledStartTime:
    "YouTube refuse la date prévue. Essayez une date ultérieure.",
  invalidPrivacyStatus:
    "YouTube refuse le paramètre de confidentialité du direct.",
  invalidAutoStart: "YouTube refuse le paramètre de démarrage automatique.",
  invalidAutoStop: "YouTube refuse le paramètre d'arrêt automatique.",
  quotaExceeded: "Le quota d'utilisation de l'API YouTube est épuisé.",
  dailyLimitExceeded: "La limite quotidienne de l'API YouTube est atteinte.",
  rateLimitExceeded:
    "Trop de demandes envoyées à YouTube. Réessayez plus tard.",
  insufficientPermissions:
    "Le compte Google n'a pas une autorisation suffisante pour cette opération.",
  forbidden:
    "YouTube interdit la création du direct avec les autorisations actuelles.",
});

export async function youtubeBroadcastFailure(response) {
  let reason = "unknown";
  try {
    const payload = await response.json();
    const value = payload?.error?.errors?.[0]?.reason;
    if (
      typeof value === "string" &&
      Object.hasOwn(YOUTUBE_BROADCAST_ERRORS, value)
    ) {
      reason = value;
    }
  } catch {
    // A non-JSON response is still represented by a safe status code.
  }
  const httpStatus =
    Number.isInteger(response.status) &&
    response.status >= 400 &&
    response.status <= 599
      ? response.status
      : 502;
  const detail =
    YOUTUBE_BROADCAST_ERRORS[reason] ??
    "YouTube a refusé la préparation. Consultez les réglages de diffusion de la chaîne.";
  return new LiveAuthError(
    502,
    `${detail} (YouTube HTTP ${httpStatus}, code : ${reason}).`,
  );
}

export async function youtubeCreateBroadcast(
  accessToken,
  input,
  fetchImpl = fetch,
) {
  const response = await fetchImpl(
    "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status,contentDetails",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        snippet: {
          title: input.title,
          scheduledStartTime: input.scheduledStartTime,
          description: "Direct préparé depuis Pilotoki Live.",
        },
        status: {
          privacyStatus: "unlisted",
          selfDeclaredMadeForKids: input.madeForKids,
        },
        contentDetails: {
          enableAutoStart: false,
          enableAutoStop: false,
        },
      }),
      cache: "no-store",
    },
  );
  if (!response.ok) throw await youtubeBroadcastFailure(response);
  const result = await response.json();
  if (!/^[A-Za-z0-9_-]{11}$/.test(result?.id ?? ""))
    throw new LiveAuthError(
      502,
      "YouTube n'a pas fourni d'identifiant de direct.",
    );
  return result.id;
}

export async function storePreparedVideo(
  env,
  clubId,
  videoId,
  input,
  fetchImpl = fetch,
) {
  const url = required(env, "VITE_SUPABASE_URL");
  const response = await fetchImpl(`${url}/rest/v1/pilotoki_live_videos`, {
    method: "POST",
    headers: {
      ...privilegedHeaders(env),
      "content-type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      club_id: clubId,
      youtube_video_id: videoId,
      title: input.title,
      source_type: input.sourceType,
      source_id: input.sourceId,
      status: "scheduled",
    }),
    cache: "no-store",
  });
  if (!response.ok)
    throw new LiveAuthError(
      502,
      "Le direct existe sur YouTube mais n'a pas pu être enregistré dans Pilotoki. Contactez l'administrateur avant de réessayer.",
    );
}

/** Map only YouTube-confirmed public/unlisted lifecycle states to the catalogue. */
export function publishedStatusFromYouTube(item, currentStatus) {
  if (currentStatus === "hidden") return null;
  const lifecycle = item?.status?.lifeCycleStatus;
  const privacy = item?.status?.privacyStatus;
  if (privacy !== "public" && privacy !== "unlisted") return null;
  if (lifecycle === "live") return "live";
  if (lifecycle === "complete") return "replay";
  return null;
}

/** Reconcile a club's published videos without giving the browser any YouTube credentials. */
export async function synchronizeClubVideos(
  env,
  clubId,
  channelId,
  fetchImpl = fetch,
) {
  const url = required(env, "VITE_SUPABASE_URL");
  const params = new URLSearchParams({
    club_id: `eq.${clubId}`,
    select: "id,youtube_video_id,status,started_at",
    status: "in.(scheduled,live,replay)",
    order: "created_at.desc",
    limit: "50",
  });
  const storedResponse = await fetchImpl(
    `${url}/rest/v1/pilotoki_live_videos?${params}`,
    { headers: privilegedHeaders(env), cache: "no-store" },
  );
  if (!storedResponse.ok)
    throw new LiveAuthError(
      502,
      "Impossible de vérifier les directs enregistrés.",
    );
  const stored = await storedResponse.json();
  if (!Array.isArray(stored) || !stored.length) return 0;
  const accessToken = await googleAccessToken(env, channelId, fetchImpl);
  const ids = stored.map((item) => item.youtube_video_id);
  if (ids.some((id) => !/^[A-Za-z0-9_-]{11}$/.test(id)))
    throw new LiveAuthError(502, "Identifiant YouTube invalide.");
  const youtubeParams = new URLSearchParams({
    part: "status,snippet",
    id: ids.join(","),
    maxResults: "50",
  });
  const youtubeResponse = await fetchImpl(
    `https://www.googleapis.com/youtube/v3/liveBroadcasts?${youtubeParams}`,
    {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    },
  );
  if (!youtubeResponse.ok)
    throw new LiveAuthError(502, "État des directs YouTube indisponible.");
  const youtube = await youtubeResponse.json();
  const byId = new Map(
    (Array.isArray(youtube?.items) ? youtube.items : [])
      .filter((item) => ids.includes(item.id))
      .map((item) => [item.id, item]),
  );
  let updated = 0;
  for (const item of stored) {
    const youtubeItem = byId.get(item.youtube_video_id);
    const status = publishedStatusFromYouTube(youtubeItem, item.status);
    if (!status || status === item.status) continue;
    // Never regress an archived replay back to "live" due to stale YouTube data.
    if (item.status === "replay" && status !== "replay") continue;
    const patch = { status };
    if (status === "live" && !item.started_at)
      patch.started_at =
        youtubeItem?.snippet?.actualStartTime || new Date().toISOString();
    const updateResponse = await fetchImpl(
      `${url}/rest/v1/pilotoki_live_videos?id=eq.${item.id}&club_id=eq.${clubId}`,
      {
        method: "PATCH",
        headers: {
          ...privilegedHeaders(env),
          "content-type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(patch),
        cache: "no-store",
      },
    );
    if (!updateResponse.ok)
      throw new LiveAuthError(
        502,
        "Échec de la mise à jour du catalogue vidéo.",
      );
    updated += 1;
  }
  return updated;
}

export async function listPreparedVideos(env, clubId, fetchImpl = fetch) {
  if (!/^[0-9a-f-]{36}$/i.test(clubId))
    throw new LiveAuthError(400, "Club invalide.");
  const url = required(env, "VITE_SUPABASE_URL");
  const params = new URLSearchParams({
    club_id: `eq.${clubId}`,
    select: "id,title,youtube_video_id,source_type,status,created_at",
    order: "created_at.desc",
    limit: "20",
  });
  const response = await fetchImpl(
    `${url}/rest/v1/pilotoki_live_videos?${params}`,
    {
      headers: privilegedHeaders(env),
      cache: "no-store",
    },
  );
  if (!response.ok)
    throw new LiveAuthError(502, "Impossible de charger les directs du club.");
  const entries = await response.json();
  return (Array.isArray(entries) ? entries : []).map((entry) => ({
    id: entry.id,
    title: entry.title,
    status: entry.status,
    sourceType: entry.source_type,
    createdAt: entry.created_at,
    youtubeUrl: `https://www.youtube.com/watch?v=${entry.youtube_video_id}`,
  }));
}
