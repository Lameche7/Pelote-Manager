import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: cors });
const hash = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response(null, { headers: cors });
  if (request.method !== "POST") return json({ error: "Method denied" }, 405);
  try {
    const mode = Deno.env.get("TOURNAMENT_STRIPE_MODE");
    const clientId = Deno.env.get("TOURNAMENT_STRIPE_CONNECT_CLIENT_ID") ?? "";
    const redirect =
      Deno.env.get("TOURNAMENT_STRIPE_CONNECT_REDIRECT_URI") ?? "";
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const token = request.headers.get("Authorization") ?? "";
    if (
      !["test", "live"].includes(mode ?? "") ||
      !/^ca_[A-Za-z0-9]+$/.test(clientId) ||
      !redirect.startsWith("https://") ||
      !url ||
      !anon
    )
      return json({ error: "Stripe Connect indisponible" }, 503);
    if (!token.startsWith("Bearer "))
      return json({ error: "Unauthorized" }, 401);
    const caller = createClient(url, anon, {
      global: { headers: { Authorization: token } },
      auth: { persistSession: false },
    });
    const { data: user, error: authError } = await caller.auth.getUser(
      token.slice(7),
    );
    if (authError || !user.user || user.user.is_anonymous)
      return json({ error: "Unauthorized" }, 401);
    const { clubId } = await request.json();
    if (
      typeof clubId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        clubId,
      )
    )
      return json({ error: "Invalid club" }, 400);
    const state = Array.from(
      crypto.getRandomValues(new Uint8Array(32)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const { error } = await caller.rpc("begin_tournament_stripe_oauth", {
      target_club_id: clubId,
      target_state_hash: await hash(state),
      target_livemode: mode === "live",
    });
    if (error) return json({ error: "Authorization denied" }, 403);
    const destination = new URL("https://connect.stripe.com/oauth/authorize");
    destination.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      scope: "read_write",
      redirect_uri: redirect,
      state,
    }).toString();
    return json({ redirectUrl: destination.href });
  } catch {
    return json({ error: "Connexion Stripe indisponible" }, 500);
  }
});
