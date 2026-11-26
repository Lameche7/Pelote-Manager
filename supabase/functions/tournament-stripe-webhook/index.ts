import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const encoder = new TextEncoder();
const json = (body: unknown, status = 200) => Response.json(body, { status });

async function verifiedBody(
  request: Request,
  secret: string,
): Promise<string | null> {
  const header = request.headers.get("stripe-signature") ?? "";
  const parts = header.split(",").map((part) => part.trim());
  const timestamps = parts.filter((part) => part.startsWith("t="));
  const signatures = parts.filter((part) => /^v1=[a-f0-9]{64}$/i.test(part));
  if (timestamps.length !== 1 || !signatures.length) return null;
  const timestamp = timestamps[0].slice(2);
  if (
    !/^\d+$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
  )
    return null;
  const body = await request.text();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  for (const signature of signatures) {
    const bytes = Uint8Array.from(signature.slice(3).match(/../g)!, (hex) =>
      parseInt(hex, 16),
    );
    if (
      await crypto.subtle.verify(
        "HMAC",
        key,
        bytes,
        encoder.encode(timestamp + "." + body),
      )
    )
      return body;
  }
  return null;
}

Deno.serve(async (request) => {
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);
  const secret = Deno.env.get("TOURNAMENT_STRIPE_WEBHOOK_SECRET");
  const mode = Deno.env.get("TOURNAMENT_STRIPE_MODE");
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (
    !secret?.startsWith("whsec_") ||
    !url ||
    !serviceKey ||
    (mode !== "test" && mode !== "live")
  )
    return json({ error: "Webhook unavailable" }, 503);
  try {
    const body = await verifiedBody(request, secret);
    if (body === null) return json({ error: "Invalid signature" }, 400);
    const event = JSON.parse(body);
    if (event.livemode !== (mode === "live"))
      return json({ error: "Wrong mode" }, 400);
    if (
      ![
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
        "checkout.session.expired",
      ].includes(event.type)
    )
      return json({ received: true });
    const session = event.data?.object;
    const attempt = session?.metadata?.attempt_id;
    // Ignore Checkout sessions unrelated to Pilotoki.
    if (!attempt) return json({ received: true });
    if (
      session.object !== "checkout.session" ||
      session.mode !== "payment" ||
      session.client_reference_id !== attempt ||
      session.livemode !== event.livemode ||
      !/^acct_[A-Za-z0-9]+$/.test(event.account ?? "") ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        attempt,
      ) ||
      !Number.isSafeInteger(session.amount_total) ||
      session.amount_total <= 0 ||
      session.currency !== "eur"
    )
      return json({ error: "Invalid checkout event" }, 400);
    const status =
      event.type === "checkout.session.expired"
        ? "expired"
        : session.payment_status === "paid" && session.status === "complete"
          ? "paid"
          : "processing";
    if (status === "expired" && session.status !== "expired")
      return json({ error: "Invalid expiration" }, 400);
    if (
      event.type === "checkout.session.async_payment_succeeded" &&
      status !== "paid"
    )
      return json({ error: "Unconfirmed payment" }, 400);
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await admin.rpc("record_tournament_stripe_event", {
      event_id: event.id,
      account_id: event.account,
      event_livemode: event.livemode,
      attempt_id: attempt,
      session_id: session.id,
      intent_id:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : null,
      paid_amount: session.amount_total,
      paid_currency: session.currency,
      event_status: status,
    });
    if (error) return json({ error: "Event not recorded" }, 500);
    return json({ received: true });
  } catch {
    return json({ error: "Webhook processing failed" }, 500);
  }
});
