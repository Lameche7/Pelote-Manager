import { createHmac, randomUUID } from "node:crypto";
import { LiveAuthError, required } from "./_live-google-shared.mjs";
import { verifiedLiveClubAdmin } from "./_live-youtube-broadcast.mjs";
import { getClubVideo } from "./_live-youtube-ingest.mjs";

// The API secret never leaves the Vercel server.
function livekitConfig(env) {
  const apiKey = required(env, "LIVEKIT_API_KEY");
  const apiSecret = required(env, "LIVEKIT_API_SECRET");
  const rawUrl = required(env, "LIVEKIT_URL");
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new LiveAuthError(503, "Adresse LiveKit invalide.");
  }
  if (
    url.protocol !== "wss:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new LiveAuthError(503, "Adresse LiveKit invalide.");
  }
  if (!apiKey || !apiSecret)
    throw new LiveAuthError(503, "Clés LiveKit manquantes.");
  return { apiKey, apiSecret, url: url.href };
}

function base64Json(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function signLivekitPublisherToken(
  apiKey,
  apiSecret,
  room,
  identity,
  now = Date.now(),
) {
  const issued = Math.floor(now / 1000);
  const header = base64Json({ alg: "HS256", typ: "JWT" });
  const claims = base64Json({
    iss: apiKey,
    sub: identity,
    iat: issued,
    nbf: issued - 5,
    exp: issued + 600,
    jti: randomUUID(),
    name: "Caméra Pilotoki",
    video: {
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: false,
      canPublishData: false,
      roomAdmin: false,
      roomCreate: false,
    },
  });
  const body = `${header}.${claims}`;
  const signature = createHmac("sha256", apiSecret)
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

/** Token scoped to the user's current authorized club and ONE prepared broadcast. */
export async function authorizeLivekitPublisher(
  request,
  env,
  fetchImpl = fetch,
) {
  const admin = await verifiedLiveClubAdmin(request, env, fetchImpl);
  if (!admin.canConnectGoogle)
    throw new LiveAuthError(403, "Diffusion mobile non activée pour ce club.");
  const video = await getClubVideo(
    env,
    admin.clubId,
    request.body?.videoId,
    fetchImpl,
  );
  const bearer = request.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
  const base = required(env, "VITE_SUPABASE_URL");
  const anon = required(env, "VITE_SUPABASE_ANON_KEY");
  const userResponse = await fetchImpl(`${base}/auth/v1/user`, {
    headers: { apikey: anon, authorization: `Bearer ${bearer}` },
    cache: "no-store",
  });
  if (!userResponse.ok)
    throw new LiveAuthError(401, "Session Pilotoki expirée.");
  const user = await userResponse.json();
  if (!/^[0-9a-f-]{36}$/i.test(user?.id ?? ""))
    throw new LiveAuthError(401, "Compte Pilotoki invalide.");
  const { apiKey, apiSecret, url } = livekitConfig(env);
  const room = `pilotoki-${admin.clubId}-${video.id}`;
  const identity = `pilotoki-camera-${user.id}`;
  const token = signLivekitPublisherToken(apiKey, apiSecret, room, identity);
  return { url, token, room, videoId: video.id, expiresIn: 600 };
}
