import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: cors });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return json({ error: "Méthode interdite." }, 405);
  try {
    // Explicit opt-in; production payments must never be enabled by default.
    const mode = Deno.env.get("TOURNAMENT_STRIPE_MODE");
    const key = Deno.env.get("TOURNAMENT_STRIPE_SECRET_KEY");
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const applicationUrl = Deno.env.get("APPLICATION_URL");
    if (mode !== "test" && mode !== "live") return json({ error: "Paiement Stripe indisponible." }, 503);
    if (!key || !url || !serviceKey || !applicationUrl ||
        !key.startsWith(mode === "live" ? "sk_live_" : "sk_test_"))
      return json({ error: "Paiement Stripe indisponible." }, 503);
    const origin = new URL(applicationUrl);
    if (origin.protocol !== "https:" || origin.username || origin.password)
      return json({ error: "Paiement Stripe indisponible." }, 503);
    const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) return json({ error: "Authentification requise." }, 401);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user || auth.user.is_anonymous)
      return json({ error: "Authentification requise." }, 401);
    const body = await request.json();
    const teamId = body?.teamId;
    if (typeof teamId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(teamId))
      return json({ error: "Inscription invalide." }, 400);
    const { data: attempt, error } = await admin.rpc("prepare_tournament_stripe_checkout", {
      target_actor_id: auth.user.id,
      target_team_id: teamId,
      expected_livemode: mode === "live",
    });
    if (error || !attempt) return json({ error: "Paiement indisponible pour cette inscription." }, 409);
    if (["paid", "processing", "disputed"].includes(attempt.status))
      return json({ status: attempt.status });
    if (attempt.status !== "creating" && attempt.status !== "open")
      return json({ error: "Paiement indisponible." }, 409);
    const headers = {
      Authorization: "Bearer " + key,
      "Stripe-Account": attempt.stripe_account_id,
      "Stripe-Version": "2025-02-24.acacia",
    };
    const returnUrl = new URL("/", origin);
    returnUrl.searchParams.set("tournamentPayment", attempt.team_id);
    const form = new URLSearchParams({
      mode: "payment",
      "payment_method_types[0]": "card",
      "line_items[0][price_data][currency]": attempt.currency,
      "line_items[0][price_data][unit_amount]": String(attempt.amount_cents),
      "line_items[0][price_data][product_data][name]": "Inscription tournoi Pilotoki",
      "line_items[0][quantity]": "1",
      "metadata[attempt_id]": attempt.attempt_id,
      "payment_intent_data[metadata][attempt_id]": attempt.attempt_id,
      client_reference_id: attempt.attempt_id,
      success_url: returnUrl.href,
      cancel_url: returnUrl.href,
      "adaptive_pricing[enabled]": "false",
    });
    const sessionId = attempt.stripe_session_id;
    // A recorded session is retrieved rather than replaced; only Stripe can
    // establish its terminal state. An uncertain request is never reset blindly.
    const stripeResponse = sessionId
      ? await fetch("https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(sessionId), { headers, signal: AbortSignal.timeout(15000) })
      : await fetch("https://api.stripe.com/v1/checkout/sessions", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": "pilotoki-tournament-" + attempt.attempt_id },
          body: form,
          signal: AbortSignal.timeout(15000),
        });
    if (!stripeResponse.ok) return json({ error: "Session de paiement indisponible." }, 502);
    const session = await stripeResponse.json();
    if (session.object !== "checkout.session" ||
        session.livemode !== attempt.livemode ||
        session.amount_total !== attempt.amount_cents ||
        session.currency !== attempt.currency ||
        session.client_reference_id !== attempt.attempt_id ||
        session.metadata?.attempt_id !== attempt.attempt_id ||
        typeof session.id !== "string" || !session.id.startsWith("cs_"))
      return json({ error: "Session de paiement incohérente." }, 502);
    if (session.status !== "open" || session.payment_status !== "unpaid")
      return json({ status: "verification_required" }, 409);
    const redirect = new URL(session.url);
    if (redirect.protocol !== "https:" || redirect.hostname !== "checkout.stripe.com")
      return json({ error: "Lien de paiement invalide." }, 502);
    // Compare-and-set: never overwrite a webhook's terminal status.
    const { data: saved, error: saveError } = await admin
      .from("tournament_stripe_payment_attempts")
      .update({ stripe_session_id: session.id, status: "open" })
      .eq("id", attempt.attempt_id)
      .in("status", ["creating", "open"])
      .select("id")
      .maybeSingle();
    if (saveError || !saved) return json({ error: "Vérification du paiement nécessaire." }, 409);
    return json({ status: "open", redirectUrl: redirect.href });
  } catch {
    return json({ error: "Impossible de préparer le paiement." }, 500);
  }
});
