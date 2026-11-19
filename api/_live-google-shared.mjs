// Server-only Google/YouTube OAuth helpers. Never import from browser code.
import {
  createCipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export class LiveAuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const CHANNEL_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;
const COOKIE_NAME = "pilotoki_live_oauth_state";
const CALLBACK_PATH = "/api/live-google-callback";

export function required(env, key) {
  const value = env[key]?.trim();
  if (!value)
    throw new LiveAuthError(
      503,
      "Connexion Google indisponible : configuration serveur manquante.",
    );
  return value;
}

export function callbackUrl(env) {
  const origin = required(env, "YOUTUBE_OAUTH_ORIGIN");
  if (!origin.startsWith("https://") || new URL(origin).origin !== origin) {
    throw new LiveAuthError(503, "Origine OAuth invalide.");
  }
  return origin + CALLBACK_PATH;
}

export function sealState(env, claims) {
  const key = required(env, "YOUTUBE_OAUTH_STATE_SECRET");
  const data = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", key).update(data).digest("base64url");
  return `${data}.${signature}`;
}

export function verifyState(env, value) {
  if (!value || value.length > 4096)
    throw new LiveAuthError(400, "Autorisation expirée.");
  const [body, signature, extra] = value.split(".");
  if (!body || !signature || extra)
    throw new LiveAuthError(400, "Autorisation invalide.");
  const expected = createHmac(
    "sha256",
    required(env, "YOUTUBE_OAUTH_STATE_SECRET"),
  )
    .update(body)
    .digest();
  const received = Buffer.from(signature, "base64url");
  if (
    received.length !== expected.length ||
    !timingSafeEqual(expected, received)
  ) {
    throw new LiveAuthError(400, "Autorisation invalide.");
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new LiveAuthError(400, "Autorisation invalide.");
  }
  if (
    !parsed?.nonce ||
    !parsed?.clubId ||
    !parsed?.userId ||
    !CHANNEL_PATTERN.test(parsed?.channelId ?? "") ||
    !Number.isInteger(parsed.exp) ||
    parsed.exp < Date.now() ||
    parsed.exp > Date.now() + 10 * 60_000
  ) {
    throw new LiveAuthError(400, "Autorisation expirée ou invalide.");
  }
  return parsed;
}

export function parseCookie(header) {
  return (
    (header ?? "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(COOKIE_NAME + "="))
      ?.slice(COOKIE_NAME.length + 1) ?? ""
  );
}

export function stateCookie(value, maxAge = 600) {
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=${CALLBACK_PATH}; Max-Age=${maxAge}`;
}

export function randomNonce() {
  return randomBytes(24).toString("base64url");
}

export function encryptRefreshToken(env, token) {
  if (typeof token !== "string" || token.length < 10) {
    throw new LiveAuthError(
      502,
      "Google n'a pas fourni d'autorisation durable. Recommencez la connexion.",
    );
  }
  const key = Buffer.from(
    required(env, "YOUTUBE_TOKEN_ENCRYPTION_KEY"),
    "base64",
  );
  if (key.length !== 32)
    throw new LiveAuthError(503, "Clé de chiffrement serveur invalide.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([encrypted, tag]).toString("base64"),
    iv: iv.toString("base64"),
  };
}

export async function verifiedClubSettings(request, env, fetchImpl = fetch) {
  const url = required(env, "VITE_SUPABASE_URL");
  const key = required(env, "VITE_SUPABASE_ANON_KEY");
  const bearer = request.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
  if (!bearer)
    throw new LiveAuthError(
      401,
      "Connectez-vous à Pilotoki pour autoriser la chaîne.",
    );
  const headers = { apikey: key, authorization: `Bearer ${bearer}` };
  const userResponse = await fetchImpl(`${url}/auth/v1/user`, {
    headers,
    cache: "no-store",
  });
  if (!userResponse.ok) throw new LiveAuthError(401, "Session expirée.");
  const user = await userResponse.json();
  if (!/^[0-9a-f-]{36}$/i.test(user?.id ?? ""))
    throw new LiveAuthError(401, "Compte invalide.");
  const rpcResponse = await fetchImpl(
    `${url}/rest/v1/rpc/admin_get_club_live_settings`,
    {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: "{}",
      cache: "no-store",
    },
  );
  if (!rpcResponse.ok)
    throw new LiveAuthError(
      403,
      "Administration Live non autorisée pour ce club.",
    );
  const settings = await rpcResponse.json();
  if (
    !/^[0-9a-f-]{36}$/i.test(settings?.club_id ?? "") ||
    !CHANNEL_PATTERN.test(settings?.youtube_channel_id ?? "")
  ) {
    throw new LiveAuthError(
      409,
      "Configurez d'abord une chaîne YouTube valide dans Pilotoki Live.",
    );
  }
  if (settings.can_connect_google !== true) {
    throw new LiveAuthError(403, "Seule l’administration pilote peut connecter la chaîne commune.");
  }
  return {
    userId: user.id,
    clubId: settings.club_id,
    channelId: settings.youtube_channel_id,
  };
}

export async function storeCredentials(
  env,
  claims,
  credentials,
  fetchImpl = fetch,
) {
  const url = required(env, "VITE_SUPABASE_URL");
  const serviceKey = required(env, "SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetchImpl(
    `${url}/rest/v1/pilotoki_live_google_credentials?on_conflict=id`,
    {
      method: "POST",
      headers: {
        apikey: serviceKey,
        // Modern sb_secret_* keys are opaque API keys, not bearer JWTs.
        ...(serviceKey.startsWith("sb_secret_")
          ? {}
          : { authorization: `Bearer ${serviceKey}` }),
        "content-type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        id: true,
        channel_id: claims.channelId,
        refresh_token_ciphertext: credentials.ciphertext,
        refresh_token_iv: credentials.iv,
        connected_by: claims.userId,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      cache: "no-store",
    },
  );
  if (!response.ok)
    throw new LiveAuthError(
      502,
      "La connexion Google n'a pas pu être enregistrée.",
    );
}

export function jsonError(res, error) {
  res.setHeader("Cache-Control", "no-store");
  res.status(error instanceof LiveAuthError ? error.status : 500).json({
    error:
      error instanceof LiveAuthError
        ? error.message
        : "Erreur de connexion Google.",
  });
}
