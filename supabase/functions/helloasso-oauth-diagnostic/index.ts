import { getHelloAssoAccessToken, type HelloAssoEnvironment } from "../_shared/helloasso.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, init?: ResponseInit) => Response.json(data, { ...init, headers: cors });
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Méthode interdite." }, { status: 405 });
  const platformUrl = Deno.env.get("PLATFORM_SUPABASE_URL");
  const platformAnonKey = Deno.env.get("PLATFORM_SUPABASE_ANON_KEY");
  const bearer = request.headers.get("authorization") ?? "";
  if (!platformUrl || !platformAnonKey) {
    return json({ error: "Configuration plateforme centrale manquante." }, { status: 503 });
  }
  if (!/^Bearer\s+\S+$/i.test(bearer)) return json({ error: "Authentification requise." }, { status: 401 });
  try {
    // Authorize against the fixed central platform, never a caller-provided URL.
    const check = await fetch(`${platformUrl.replace(/\/$/, "")}/rest/v1/rpc/platform_is_admin`, {
      method: "POST",
      headers: { apikey: platformAnonKey, authorization: bearer, "content-type": "application/json" },
      body: "{}",
    });
    if (!check.ok || await check.json() !== true) {
      return json({ error: "Accès super administrateur refusé." }, { status: 403 });
    }
    const clientId = Deno.env.get("HELLOASSO_CLIENT_ID");
    const clientSecret = Deno.env.get("HELLOASSO_CLIENT_SECRET");
    if (!clientId || !clientSecret) return json({ error: "Configuration HelloAsso manquante." }, { status: 503 });
    const environment = Deno.env.get("HELLOASSO_ENVIRONMENT") === "production" ? "production" : "sandbox";
    const url = environment === "production" ? "https://api.helloasso.com/oauth2/token" : "https://api.helloasso-sandbox.com/oauth2/token";
    const body = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret });
    const timestamp = new Date().toISOString();
    const response = await fetch(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", "user-agent": "Pilotoki/1.0 (HelloAsso integration; contact via Pilotoki support)" },
      body,
    });
    const raw = await response.text();
    const info = {
      ok: response.ok,
      timestamp,
      status: response.status,
      rayId: response.headers.get("cf-ray"),
      server: response.headers.get("server"),
      cfMitigated: response.headers.get("cf-mitigated"),
      contentType: response.headers.get("content-type"),
    };
    if (response.ok) return json(info);
    // Only return a limited body for Cloudflare 403, never OAuth responses that could contain credentials.
    const responseBody = response.status === 403 && /text\/html/i.test(info.contentType ?? "")
      ? raw.slice(0, 6000) : undefined;
    console.error("helloasso_oauth_diagnostic", JSON.stringify({ ...info, responseBody }));
    return json({ ...info, responseBody, error: "HelloAsso a refusé la connexion." });
  } catch {
    return json({ ok: false, error: "Erreur réseau pendant le test." }, { status: 502 });
  }
});
