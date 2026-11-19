// Public, non-sensitive readiness check: never return OAuth IDs, tokens or secrets.
const REQUIRED_KEYS = [
  "YOUTUBE_OAUTH_CLIENT_ID",
  "YOUTUBE_OAUTH_CLIENT_SECRET",
  "YOUTUBE_OAUTH_ORIGIN",
  "YOUTUBE_OAUTH_STATE_SECRET",
  "YOUTUBE_TOKEN_ENCRYPTION_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
];

export default function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Méthode non autorisée." });
  }
  const configured = REQUIRED_KEYS.every(
    (key) =>
      typeof process.env[key] === "string" &&
      process.env[key].trim().length > 0,
  );
  return response.status(200).json({ configured });
}
