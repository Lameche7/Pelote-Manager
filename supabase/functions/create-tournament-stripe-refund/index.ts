import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: cors });
const uuid = (value: unknown) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response(null, { headers: cors });
  if (request.method !== "POST")
    return json({ error: "Méthode interdite." }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const key = Deno.env.get("TOURNAMENT_STRIPE_SECRET_KEY");
    if (
      Deno.env.get("TOURNAMENT_STRIPE_MODE") !== "live" ||
      Deno.env.get("TOURNAMENT_STRIPE_REFUNDS_ENABLED") !== "true" ||
      !key?.startsWith("sk_live_") ||
      !url ||
      !anonKey ||
      !serviceKey
    )
      return json({ error: "Remboursements Stripe indisponibles." }, 503);
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
    const body = await request.json();
    if (
      !uuid(body?.clubId) ||
      !uuid(body?.tournamentId) ||
      !uuid(body?.teamId) ||
      !uuid(body?.attemptId) ||
      !uuid(body?.operationId) ||
      !Number.isSafeInteger(body?.amountCents) ||
      body.amountCents <= 0 ||
      typeof body.reason !== "string" ||
      !body.reason.trim() ||
      body.reason.trim().length > 500
    )
      return json({ error: "Demande invalide." }, 400);

    // Authorization is evaluated as the actual signed-in user, never as service_role.
    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: "Bearer " + token } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: id, error: prepareError } = await caller.rpc(
      "admin_prepare_tournament_stripe_refund_for_club",
      {
        target_club_id: body.clubId,
        target_tournament_id: body.tournamentId,
        target_team_id: body.teamId,
        target_attempt_id: body.attemptId,
        refund_cents: body.amountCents,
        refund_reason: body.reason,
        operation_id: body.operationId,
      },
    );
    if (prepareError || !uuid(id))
      return json({ error: "Remboursement non autorisé ou indisponible." }, 409);

    const { data: refund, error: readError } = await admin
      .from("tournament_payment_refunds")
      .select("id,status,requested_at,amount_cents,stripe_refund_id,stripe_attempt_id")
      .eq("id", id)
      .eq("club_id", body.clubId)
      .eq("tournament_id", body.tournamentId)
      .eq("team_id", body.teamId)
      .single();
    if (readError || !refund)
      return json({ error: "Vérification du remboursement nécessaire." }, 409);
    if (["succeeded", "failed", "cancelled"].includes(refund.status))
      return json({ refundId: id, status: refund.status });
    const { data: payment, error: paymentError } = await admin
      .from("tournament_stripe_payment_attempts")
      .select("stripe_account_id,stripe_payment_intent_id,livemode")
      .eq("id", refund.stripe_attempt_id)
      .eq("club_id", body.clubId)
      .eq("tournament_id", body.tournamentId)
      .eq("team_id", body.teamId)
      .single();
    if (paymentError || !payment?.livemode || !payment.stripe_payment_intent_id)
      return json({ error: "Paiement d’origine introuvable." }, 409);
    const headers = {
      Authorization: "Bearer " + key,
      "Stripe-Account": payment.stripe_account_id,
      "Stripe-Version": "2025-02-24.acacia",
    };
    // Never replay an unconfirmed POST after the provider's idempotency window.
    const age = Date.now() - Date.parse(refund.requested_at);
    if (!refund.stripe_refund_id && (!Number.isFinite(age) || age > 20 * 3600000))
      return json({ refundId: id, status: "verification_required" }, 409);
    const response = refund.stripe_refund_id
      ? await fetch(
          "https://api.stripe.com/v1/refunds/" +
            encodeURIComponent(refund.stripe_refund_id),
          { headers, signal: AbortSignal.timeout(15000) },
        )
      : await fetch("https://api.stripe.com/v1/refunds", {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/x-www-form-urlencoded",
            "Idempotency-Key": "pilotoki-refund-" + id,
          },
          body: new URLSearchParams({
            payment_intent: payment.stripe_payment_intent_id,
            amount: String(refund.amount_cents),
            "metadata[pilotoki_refund_id]": String(id),
          }),
          signal: AbortSignal.timeout(15000),
        });
    if (!response.ok)
      return json({ refundId: id, status: "verification_required" }, 502);
    const result = await response.json();
    if (
      result.object !== "refund" ||
      result.metadata?.pilotoki_refund_id !== id ||
      (refund.stripe_refund_id && result.id !== refund.stripe_refund_id)
    )
      return json({ refundId: id, status: "verification_required" }, 502);
    const { data: status, error: recordError } = await admin.rpc(
      "record_tournament_stripe_refund",
      {
        target_refund_id: id,
        provider_account: payment.stripe_account_id,
        provider_intent: result.payment_intent,
        provider_refund_id: result.id,
        provider_amount: result.amount,
        provider_currency: result.currency,
        provider_livemode: true,
        provider_status: result.status,
      },
    );
    if (recordError)
      return json({ refundId: id, status: "verification_required" }, 502);
    return json({ refundId: id, status });
  } catch {
    return json({ error: "Remboursement non confirmé. Ne pas renouveler avec une nouvelle demande." }, 500);
  }
});
