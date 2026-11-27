import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: cors });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response(null, { headers: cors });
  if (request.method !== "POST")
    return json({ error: "Méthode interdite." }, 405);
  try {
    const key = Deno.env.get("TOURNAMENT_STRIPE_SECRET_KEY");
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const returnOrigin = Deno.env.get("TOURNAMENT_STRIPE_CONNECT_REDIRECT_URI");
    if (
      Deno.env.get("TOURNAMENT_STRIPE_MODE") !== "test" ||
      !key?.startsWith("sk_test_") ||
      !url ||
      !serviceKey ||
      !returnOrigin
    )
      return json({ error: "Diagnostic Stripe indisponible." }, 503);
    const origin = new URL(returnOrigin);
    if (origin.protocol !== "https:" || origin.username || origin.password)
      return json({ error: "Diagnostic Stripe indisponible." }, 503);
    const token = request.headers
      .get("authorization")
      ?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) return json({ error: "Authentification requise." }, 401);
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user || auth.user.is_anonymous)
      return json({ error: "Authentification requise." }, 401);
    const { clubId } = await request.json();
    if (typeof clubId !== "string" || !uuid.test(clubId))
      return json({ error: "Club invalide." }, 400);
    const { data: attempt, error } = await admin.rpc(
      "prepare_tournament_stripe_diagnostic",
      { target_club_id: clubId, target_actor_id: auth.user.id },
    );
    if (error || !attempt)
      return json({ error: "Diagnostic non autorisé ou indisponible." }, 403);
    if (
      !uuid.test(attempt.id) ||
      attempt.club_id !== clubId ||
      attempt.actor_id !== auth.user.id ||
      attempt.amount_cents !== 100 ||
      !/^acct_[A-Za-z0-9]+$/.test(attempt.stripe_account_id)
    )
      return json({ error: "Diagnostic incohérent." }, 502);
    if (attempt.status === "processing") return json({ status: "processing" });
    if (!["creating", "open"].includes(attempt.status))
      return json({ error: "Diagnostic indisponible." }, 409);
    const headers = {
      Authorization: "Bearer " + key,
      "Stripe-Account": attempt.stripe_account_id,
      "Stripe-Version": "2025-02-24.acacia",
    };
    const returnUrl = new URL("/stripe/diagnostic/return", origin);
    returnUrl.searchParams.set("stripeDiagnostic", clubId);
    const form = new URLSearchParams({
      mode: "payment",
      "payment_method_types[0]": "card",
      "line_items[0][price_data][currency]": "eur",
      "line_items[0][price_data][unit_amount]": "100",
      "line_items[0][price_data][product_data][name]":
        "Pilotoki – diagnostic fictif Stripe",
      "line_items[0][quantity]": "1",
      "metadata[attempt_id]": attempt.id,
      "metadata[pilotoki_diagnostic]": "1",
      client_reference_id: attempt.id,
      success_url: returnUrl.href,
      cancel_url: returnUrl.href,
      "adaptive_pricing[enabled]": "false",
    });
    const age = Date.now() - Date.parse(attempt.created_at);
    if (
      !attempt.stripe_session_id &&
      (!Number.isFinite(age) || age < 0 || age > 20 * 3600000)
    )
      return json({ status: "verification_required" }, 409);
    const response = attempt.stripe_session_id
      ? await fetch(
          "https://api.stripe.com/v1/checkout/sessions/" +
            encodeURIComponent(attempt.stripe_session_id),
          { headers, signal: AbortSignal.timeout(15000) },
        )
      : await fetch("https://api.stripe.com/v1/checkout/sessions", {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/x-www-form-urlencoded",
            "Idempotency-Key": "pilotoki-diagnostic-" + attempt.id,
          },
          body: form,
          signal: AbortSignal.timeout(15000),
        });
    if (!response.ok)
      return json({ error: "Session de test indisponible." }, 502);
    const session = await response.json();
    if (
      session.object !== "checkout.session" ||
      session.livemode !== false ||
      session.amount_total !== 100 ||
      session.currency !== "eur" ||
      session.client_reference_id !== attempt.id ||
      session.metadata?.attempt_id !== attempt.id ||
      session.metadata?.pilotoki_diagnostic !== "1" ||
      !/^cs_test_[A-Za-z0-9_]+$/.test(session.id)
    )
      return json({ error: "Session de test incohérente." }, 502);
    if (session.status !== "open" || session.payment_status !== "unpaid")
      return json({ status: "verification_required" }, 409);
    const destination = new URL(session.url);
    if (
      destination.protocol !== "https:" ||
      destination.hostname !== "checkout.stripe.com"
    )
      return json({ error: "Lien de test invalide." }, 502);
    const { data: saved, error: saveError } = await admin
      .from("tournament_stripe_diagnostic_attempts")
      .update({ stripe_session_id: session.id, status: "open" })
      .eq("id", attempt.id)
      .in("status", ["creating", "open"])
      .select("id")
      .maybeSingle();
    if (saveError || !saved)
      return json({ error: "Vérification du diagnostic nécessaire." }, 409);
    return json({ status: "open", redirectUrl: destination.href });
  } catch {
    return json({ error: "Impossible de préparer le diagnostic." }, 500);
  }
});
