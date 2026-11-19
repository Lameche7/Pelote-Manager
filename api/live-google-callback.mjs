import {
  callbackUrl,
  encryptRefreshToken,
  jsonError,
  parseCookie,
  required,
  stateCookie,
  storeCredentials,
  verifyState,
  LiveAuthError,
} from "./_live-google-shared.mjs";

function redirect(response, success, reason) {
  const params = new URLSearchParams({
    live_google: success ? "connected" : "error",
  });
  if (!success) params.set("reason", reason);
  response.statusCode = 303;
  response.setHeader("Location", `/admin/parametres/live?${params}`);
  response.end();
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Set-Cookie", stateCookie("", 0));
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Méthode non autorisée." });
  }
  try {
    const env = process.env;
    const oauthState = new URL(request.url, "https://pilotoki.invalid")
      .searchParams;
    if (oauthState.has("error"))
      throw new LiveAuthError(400, "Autorisation Google refusée.");
    const code = oauthState.get("code");
    const state = oauthState.get("state");
    if (!code || !state || code.length > 2048) {
      throw new LiveAuthError(400, "Réponse Google incomplète.");
    }
    const claims = verifyState(env, state);
    const cookieNonce = parseCookie(request.headers.cookie);
    if (!cookieNonce || cookieNonce !== claims.nonce) {
      throw new LiveAuthError(
        400,
        "Connexion expirée ou navigateur différent.",
      );
    }
    const clientId = required(env, "YOUTUBE_OAUTH_CLIENT_ID");
    const clientSecret = required(env, "YOUTUBE_OAUTH_CLIENT_SECRET");
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl(env),
        grant_type: "authorization_code",
      }).toString(),
      cache: "no-store",
    });
    if (!tokenResponse.ok) {
      throw new LiveAuthError(
        502,
        "Échange de l'autorisation Google impossible.",
      );
    }
    const tokens = await tokenResponse.json();
    if (!tokens?.access_token || !tokens?.refresh_token) {
      throw new LiveAuthError(
        502,
        "Google n'a pas transmis l'autorisation durable.",
      );
    }
    const channelResponse = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=id&mine=true",
      {
        headers: { authorization: `Bearer ${tokens.access_token}` },
        cache: "no-store",
      },
    );
    if (!channelResponse.ok) {
      throw new LiveAuthError(502, "Impossible de vérifier la chaîne YouTube.");
    }
    const channels = await channelResponse.json();
    if (!channels?.items?.some((channel) => channel.id === claims.channelId)) {
      throw new LiveAuthError(
        409,
        "Le compte Google sélectionné ne possède pas la chaîne configurée pour ce club.",
      );
    }
    const encrypted = encryptRefreshToken(env, tokens.refresh_token);
    await storeCredentials(env, claims, encrypted);
    redirect(response, true, "");
  } catch (error) {
    // Return only a generic, non-sensitive reason via the redirect URL.
    // No authorization code, tokens or Google response body is logged.
    const reason =
      error instanceof LiveAuthError ? String(error.status) : "500";
    redirect(response, false, reason);
  }
}
