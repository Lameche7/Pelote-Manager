import {
  callbackUrl,
  jsonError,
  randomNonce,
  required,
  sealState,
  stateCookie,
  verifiedClubSettings,
} from "./_live-google-shared.mjs";
import readinessHandler from "./_live-google-configuration.mjs";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Vary", "Authorization");
  if (request.method === "GET") return readinessHandler(request, response);
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Méthode non autorisée." });
  }
  try {
    const env = process.env;
    const clientId = required(env, "YOUTUBE_OAUTH_CLIENT_ID");
    required(env, "YOUTUBE_OAUTH_CLIENT_SECRET");
    required(env, "YOUTUBE_OAUTH_STATE_SECRET");
    required(env, "YOUTUBE_TOKEN_ENCRYPTION_KEY");
    required(env, "SUPABASE_SERVICE_ROLE_KEY");
    const settings = await verifiedClubSettings(request, env);
    const nonce = randomNonce();
    const state = sealState(env, {
      ...settings,
      nonce,
      exp: Date.now() + 10 * 60_000,
    });
    // The state is bound to an HTTP-only browser cookie, so a forged callback
    // cannot connect an arbitrary Google account to a club.
    response.setHeader("Set-Cookie", stateCookie(nonce));
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl(env),
      response_type: "code",
      scope: "https://www.googleapis.com/auth/youtube",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    return response.status(200).json({
      authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    });
  } catch (error) {
    return jsonError(response, error);
  }
}
