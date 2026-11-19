import { createDecipheriv, createHmac, timingSafeEqual } from "node:crypto";
import { LiveAuthError, jsonError, required } from "./_live-google-shared.mjs";
import {
  verifiedLiveClubAdmin,
  privilegedHeaders,
} from "./_live-youtube-broadcast.mjs";
import {
  getClubVideo,
  existingIngest,
  validateVideoId,
} from "./_live-youtube-ingest.mjs";

function bridgeConfig(env) {
  const url = required(env, "LIVE_BRIDGE_CONTROL_URL");
  if (!/^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(url))
    throw new LiveAuthError(503, "URL HTTPS de la passerelle invalide.");
  return { url, secret: required(env, "LIVE_BRIDGE_SHARED_SECRET") };
}
export function decryptIngest(env, record) {
  const bytes = Buffer.from(record?.ingest_ciphertext || "", "base64");
  const key = Buffer.from(
    required(env, "YOUTUBE_TOKEN_ENCRYPTION_KEY"),
    "base64",
  );
  if (key.length !== 32 || bytes.length < 17 || !record?.ingest_iv)
    throw new LiveAuthError(503, "Configuration YouTube incomplète.");
  try {
    const dec = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(record.ingest_iv, "base64"),
    );
    dec.setAuthTag(bytes.subarray(-16));
    const value = JSON.parse(
      Buffer.concat([dec.update(bytes.subarray(0, -16)), dec.final()]).toString(
        "utf8",
      ),
    );
    if (
      typeof value.address !== "string" ||
      typeof value.streamName !== "string" ||
      !/^rtmps:\/\/[a-z0-9.-]*rtmp\.youtube\.com\/live2\/?$/i.test(
        value.address,
      ) ||
      !/^[A-Za-z0-9_-]{1,256}(?:-[A-Za-z0-9_-]+)*$/.test(value.streamName)
    )
      throw new Error("Invalid ingestion");
    return `${value.address.replace(/\/$/, "")}/${value.streamName}`;
  } catch {
    throw new LiveAuthError(
      503,
      "Impossible de déchiffrer les paramètres YouTube.",
    );
  }
}
async function fetchIngest(env, videoId, fetchImpl = fetch) {
  const url = required(env, "VITE_SUPABASE_URL");
  const response = await fetchImpl(
    `${url}/rest/v1/pilotoki_live_ingest_credentials?video_id=eq.${validateVideoId(videoId)}&select=ingest_ciphertext,ingest_iv`,
    { headers: privilegedHeaders(env), cache: "no-store" },
  );
  if (!response.ok)
    throw new LiveAuthError(503, "Destination YouTube indisponible.");
  const records = await response.json();
  if (!records?.[0])
    throw new LiveAuthError(409, "Liez d'abord le flux YouTube.");
  return decryptIngest(env, records[0]);
}
function sign(env, value) {
  return createHmac("sha256", required(env, "LIVE_BRIDGE_SHARED_SECRET"))
    .update(value)
    .digest("hex");
}
export function createStopTicket(env, data) {
  const raw = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${raw}.${sign(env, raw)}`;
}
export function verifyStopTicket(env, ticket, clubId) {
  if (
    typeof ticket !== "string" ||
    ticket.length > 2048 ||
    !/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(ticket)
  )
    throw new LiveAuthError(400, "Session de direct invalide.");
  const [raw, signature] = ticket.split(".");
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(sign(env, raw))))
    throw new LiveAuthError(403, "Commande de direct refusée.");
  let payload;
  try {
    payload = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new LiveAuthError(400, "Session de direct illisible.");
  }
  if (
    payload.clubId !== clubId ||
    !/^[a-f0-9]{32}$/.test(payload.sessionId || "") ||
    !Number.isFinite(payload.expires) ||
    payload.expires < Date.now()
  )
    throw new LiveAuthError(
      403,
      "La session de direct a expiré ou appartient à un autre club.",
    );
  return payload;
}
async function control(env, command, body, fetchImpl = fetch) {
  const { url, secret } = bridgeConfig(env);
  const response = await fetchImpl(`${url}/control/${command}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    if (response.status === 409)
      throw new LiveAuthError(
        409,
        "Un direct est déjà en cours sur la passerelle.",
      );
    throw new LiveAuthError(
      502,
      "La passerelle vidéo ne répond pas correctement.",
    );
  }
  return response.json();
}
export async function performStart(env, clubId, videoId, fetchImpl = fetch) {
  await getClubVideo(env, clubId, videoId, fetchImpl);
  if (!(await existingIngest(env, videoId, fetchImpl)))
    throw new LiveAuthError(409, "Liez d'abord le flux YouTube.");
  const ingestUrl = await fetchIngest(env, videoId, fetchImpl);
  const result = await control(env, "start", { ingestUrl }, fetchImpl);
  if (
    !/^https:\/\/[a-z0-9.-]+\/live\/[a-f0-9]{32}\/whip$/i.test(
      result.whipUrl || "",
    ) ||
    !/^[a-f0-9]{32}$/.test(result.sessionId || "") ||
    !/^[a-f0-9]{64}$/.test(result.publishToken || "")
  )
    throw new LiveAuthError(502, "Réponse de la passerelle vidéo invalide.");
  return {
    whipUrl: result.whipUrl,
    publishToken: result.publishToken,
    ticket: createStopTicket(env, {
      clubId,
      sessionId: result.sessionId,
      expires: Date.now() + 20 * 60_000,
    }),
    expiresAt: result.expiresAt,
  };
}
export async function performStop(env, clubId, ticket, fetchImpl = fetch) {
  const { sessionId } = verifyStopTicket(env, ticket, clubId);
  await control(env, "stop", { sessionId }, fetchImpl);
  return { stopped: true };
}
export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Vary", "Authorization");
  if (request.method !== "POST")
    return response.status(405).json({ error: "Méthode non autorisée." });
  try {
    if (process.env.LIVE_BRIDGE_TEST_ENABLED !== "true")
      throw new LiveAuthError(503, "Le test vidéo n'est pas encore activé.");
    const { clubId } = await verifiedLiveClubAdmin(request, process.env);
    if (request.body?.action === "start") {
      const result = await performStart(
        process.env,
        clubId,
        request.body?.videoId,
      );
      return response.status(201).json(result);
    }
    if (request.body?.action === "stop") {
      const result = await performStop(
        process.env,
        clubId,
        request.body?.ticket,
      );
      return response.status(200).json(result);
    }
    throw new LiveAuthError(400, "Action inconnue.");
  } catch (error) {
    return jsonError(response, error);
  }
}
