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
    const secret = Deno.env.get("TOURNAMENT_STRIPE_SECRET_KEY") ?? "";
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const token = request.headers.get("Authorization") ?? "";
    if (
      !["test", "live"].includes(mode ?? "") ||
      !secret.startsWith(mode === "live" ? "sk_live_" : "sk_test_") ||
      !url ||
      !anon ||
      !service
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
    const { state, code } = await request.json();
    if (
      typeof state !== "string" ||
      !/^[0-9a-f]{64}$/.test(state) ||
      typeof code !== "string" ||
      !/^ac_[A-Za-z0-9]+$/.test(code)
    )
      return json({ error: "Invalid authorization" }, 400);
    const { data: clubId, error: stateError } = await caller.rpc(
      "consume_tournament_stripe_oauth",
      {
        target_state_hash: await hash(state),
        target_livemode: mode === "live",
      },
    );
    if (stateError || typeof clubId !== "string")
      return json({ error: "Authorization expired or denied" }, 403);
    const response = await fetch("https://connect.stripe.com/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code }),
    });
    if (!response.ok)
      return json({ error: "Stripe authorization not confirmed" }, 502);
    const authorization = await response.json();
    const accountId = authorization.stripe_user_id;
    if (
      typeof accountId !== "string" ||
      !/^acct_[A-Za-z0-9]+$/.test(accountId) ||
      authorization.livemode !== (mode === "live") ||
      authorization.scope !== "read_write"
    )
      return json({ error: "Invalid Stripe account authorization" }, 502);
    const accountResponse = await fetch(
      `https://api.stripe.com/v1/accounts/${accountId}`,
      {
        headers: {
          Authorization: `Bearer ${secret}`,
          "Stripe-Version": "2025-02-24.acacia",
        },
      },
    );
    if (!accountResponse.ok)
      return json({ error: "Stripe account verification failed" }, 502);
    const account = await accountResponse.json();
    if (account.id !== accountId || account.object !== "account")
      return json({ error: "Stripe account mismatch" }, 502);
    const admin = createClient(url, service, {
      auth: { persistSession: false },
    });
    const { error: saveError } = await admin.rpc(
      "complete_tournament_stripe_oauth",
      {
        target_state_hash: await hash(state),
        target_actor_id: user.user.id,
        target_club_id: clubId,
        target_livemode: mode === "live",
        target_account_id: accountId,
        target_charges_enabled: account.charges_enabled === true,
      },
    );
    if (saveError)
      return json({ error: "Stripe connection could not be recorded" }, 409);
    return json({
      clubId,
      connected: true,
      chargesEnabled: account.charges_enabled === true,
    });
  } catch {
    return json({ error: "Connexion Stripe non confirmée" }, 500);
  }
});
