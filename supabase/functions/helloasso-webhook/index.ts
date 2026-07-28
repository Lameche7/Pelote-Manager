import { createClient } from "npm:@supabase/supabase-js@2";

type HelloAssoWebhook = {
  eventType?: string;
  metadata?: Record<string, unknown>;
  data?: {
    id?: number;
    state?: string;
    amount?: number;
    totalAmount?: number;
    checkoutIntentId?: number;
    order?: { id?: number };
    payments?: Array<{ id?: number; amount?: number; state?: string }>;
  };
};

function eventIdentity(payload: HelloAssoWebhook, rawBody: string): string {
  const paymentId = payload.data?.id ?? payload.data?.payments?.[0]?.id ?? "none";
  const orderId = payload.data?.order?.id ?? "none";
  return `${payload.eventType ?? "unknown"}:${paymentId}:${orderId}:${rawBody.length}`;
}

Deno.serve(async (request) => {
  try {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const webhookToken = Deno.env.get("HELLOASSO_WEBHOOK_TOKEN");

    if (!supabaseUrl || !serviceRoleKey || !webhookToken) {
      throw new Error("Configuration webhook incomplète.");
    }

    const suppliedToken = new URL(request.url).searchParams.get("token");
    if (suppliedToken !== webhookToken) {
      return new Response("Unauthorized", { status: 401 });
    }

    const rawBody = await request.text();
    const payload = JSON.parse(rawBody) as HelloAssoWebhook;
    const paymentId = String(payload.metadata?.payment_id ?? "");

    if (!paymentId) {
      return Response.json({ ignored: true, reason: "payment_id metadata missing" });
    }

    const providerPayment = payload.data?.payments?.[0];
    const state = String(providerPayment?.state ?? payload.data?.state ?? "pending");
    const paidAmount = Number(
      providerPayment?.amount ?? payload.data?.amount ?? payload.data?.totalAmount ?? 0,
    );

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data, error } = await supabase.rpc("apply_helloasso_payment_event", {
      event_key: eventIdentity(payload, rawBody),
      event_type: payload.eventType ?? "Unknown",
      event_payload: payload,
      target_payment_id: paymentId,
      checkout_intent_id: payload.data?.checkoutIntentId
        ? String(payload.data.checkoutIntentId)
        : null,
      order_id: payload.data?.order?.id ? String(payload.data.order.id) : null,
      provider_payment_id: providerPayment?.id
        ? String(providerPayment.id)
        : payload.data?.id
          ? String(payload.data.id)
          : null,
      paid_amount_cents: paidAmount,
      provider_state: state,
    });

    if (error) throw error;
    return Response.json({ processed: Boolean(data) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inattendue.";
    return Response.json({ error: message }, { status: 400 });
  }
});
