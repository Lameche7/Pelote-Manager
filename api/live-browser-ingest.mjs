// Browser WebRTC signalling proxy. MEDIA DOES NOT TRANSIT VERCEL.
// Requires a separately managed WHIP-to-RTMPS encoder service.
import { createHmac, timingSafeEqual } from "node:crypto";
import { jsonError, LiveAuthError, required } from "./_live-google-shared.mjs";
import { verifiedLiveClubAdmin } from "./_live-youtube-broadcast.mjs";
import { getClubVideo } from "./_live-youtube-ingest.mjs";

const VIDEO_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_OFFER = 120_000;
const SESSION_AGE_MS = 2 * 60 * 60 * 1000;
const WHIP_ENDPOINT = "LIVE_WHIP_INGEST_URL";
const INGEST_AUTH_ENV_NAME = "LIVE_WHIP_API_TOKEN";
const SESSION_SIGN_ENV_NAME = "LIVE_WHIP_SESSION_SECRET";

function configuredEndpoint(env) {
  const raw = required(env, WHIP_ENDPOINT);
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new LiveAuthError(503, "Passerelle vidéo non configurée.");
  return url;
}

function seal(env, claims) {
  const content = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const tag = createHmac("sha256", required(env, SESSION_SIGN_ENV_NAME))
    .update(content)
    .digest("base64url");
  return `${content}.${tag}`;
}

function unseal(env, token) {
  if (typeof token !== "string" || token.length > 4096)
    throw new LiveAuthError(400, "Session caméra invalide.");
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra)
    throw new LiveAuthError(400, "Session caméra invalide.");
  const expected = createHmac("sha256", required(env, SESSION_SIGN_ENV_NAME))
    .update(body)
    .digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(expected, actual))
    throw new LiveAuthError(403, "Session caméra invalide.");
  let claims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new LiveAuthError(400, "Session caméra invalide.");
  }
  if (
    !claims ||
    claims.exp < Date.now() ||
    claims.exp > Date.now() + SESSION_AGE_MS
  )
    throw new LiveAuthError(403, "Session caméra expirée.");
  return claims;
}

export async function handleWhip(request, response, env, fetchImpl = fetch) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Vary", "Authorization");
  if (!["POST", "DELETE"].includes(request.method)) {
    response.setHeader("Allow", "POST, DELETE");
    return response.status(405).json({ error: "Méthode non autorisée." });
  }
  try {
    const admin = await verifiedLiveClubAdmin(request, env, fetchImpl);
    if (!admin.canConnectGoogle)
      throw new LiveAuthError(403, "Émission mobile réservée au club pilote.");
    const videoId = request.body?.videoId;
    if (!VIDEO_ID.test(videoId ?? ""))
      throw new LiveAuthError(400, "Identifiant vidéo invalide.");
    const video = await getClubVideo(
      env,
      admin.clubId,
      videoId,
      fetchImpl,
      request.method === "DELETE",
    );
    const endpoint = configuredEndpoint(env);
    const apiToken = required(env, INGEST_AUTH_ENV_NAME);
    const headers = { Authorization: `Bearer ${apiToken}` };
    if (request.method === "POST") {
      const offer = request.body?.offer;
      if (
        typeof offer !== "string" ||
        offer.length < 20 ||
        offer.length > MAX_OFFER ||
        !offer.startsWith("v=0")
      )
        throw new LiveAuthError(400, "Offre WebRTC invalide.");
      // Strictly authenticate and validate before invoking the media service.
      const ingest = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/sdp",
          accept: "application/sdp",
        },
        body: offer,
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
      });
      if (ingest.status !== 201)
        throw new LiveAuthError(502, "Passerelle vidéo indisponible.");
      const answer = await ingest.text();
      const location = ingest.headers.get("location");
      if (answer.length > MAX_OFFER || !answer.startsWith("v=0") || !location)
        throw new LiveAuthError(502, "Réponse WebRTC invalide.");
      const resource = new URL(location, endpoint);
      if (
        resource.protocol !== "https:" ||
        resource.origin !== endpoint.origin ||
        resource.username ||
        resource.password ||
        resource.hash
      )
        throw new LiveAuthError(502, "Session de la passerelle invalide.");
      const session = seal(env, {
        resource: resource.href,
        clubId: admin.clubId,
        videoId: video.id,
        exp: Date.now() + SESSION_AGE_MS,
      });
      return response.status(201).json({ answer, session });
    }
    const claims = unseal(env, request.body?.session);
    if (claims.clubId !== admin.clubId || claims.videoId !== video.id)
      throw new LiveAuthError(403, "Session liée à un autre direct.");
    const resource = new URL(claims.resource);
    if (resource.origin !== endpoint.origin)
      throw new LiveAuthError(403, "Session liée à une autre passerelle.");
    const deleted = await fetchImpl(resource, {
      method: "DELETE",
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
    });
    if (![200, 204, 404, 410].includes(deleted.status))
      throw new LiveAuthError(502, "Fermeture de la caméra non confirmée.");
    return response.status(200).json({ stopped: true });
  } catch (error) {
    return jsonError(response, error);
  }
}
export default (request, response) =>
  handleWhip(request, response, process.env);
