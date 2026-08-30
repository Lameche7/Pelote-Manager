import { createClient } from "npm:@supabase/supabase-js@2";
import {
  createHelloAssoCheckout,
  getHelloAssoAccessToken,
  type HelloAssoEnvironment,
} from "../_shared/helloasso.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authorization = request.headers.get("authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const clientId = Deno.env.get("HELLOASSO_CLIENT_ID");
    const clientSecret = Deno.env.get("HELLOASSO_CLIENT_SECRET");
    const organizationSlug = Deno.env.get("HELLOASSO_ORGANIZATION_SLUG");
    const environment = (Deno.env.get("HELLOASSO_ENVIRONMENT") ??
      "sandbox") as HelloAssoEnvironment;
    const applicationUrl = Deno.env.get("APPLICATION_URL");

    if (
      !supabaseUrl ||
      !serviceRoleKey ||
      !clientId ||
      !clientSecret ||
      !organizationSlug ||
      !applicationUrl
    ) {
      throw new Error("Configuration HelloAsso incomplète.");
    }

    const { paymentId } = (await request.json()) as { paymentId?: string };
    if (!paymentId) throw new Error("Identifiant de paiement manquant.");

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });

    const { data, error } = await supabase.rpc("get_payment_for_checkout", {
      target_payment_id: paymentId,
    });
    if (error) throw error;

    const payment = data?.[0];
    if (!payment) throw new Error("Paiement expiré ou introuvable.");

    const accessToken = await getHelloAssoAccessToken({
      environment,
      clientId,
      clientSecret,
    });

    const returnPath =
      payment.payment_plan === "split"
        ? "/reservations/paiement-part"
        : "/reservations/paiement";
    const returnBase = `${applicationUrl}${returnPath}?paymentId=${encodeURIComponent(payment.payment_id)}`;
    const checkout = await createHelloAssoCheckout({
      environment,
      accessToken,
      organizationSlug,
      amountCents: payment.amount_cents,
      itemName: payment.item_name,
      payer: {
        email: payment.payer_email || undefined,
      },
      metadata: {
        payment_id: payment.payment_id,
        reservation_id: payment.reservation_id,
      },
      backUrl: `${returnBase}&result=back`,
      errorUrl: `${returnBase}&result=error`,
      returnUrl: `${returnBase}&result=return`,
    });

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const { error: registrationError } = await admin.rpc(
      "register_helloasso_checkout",
      {
        target_payment_id: payment.payment_id,
        checkout_intent_id: String(checkout.id),
        checkout_redirect_url: checkout.redirectUrl,
      },
    );
    if (registrationError) throw registrationError;

    return Response.json(
      { paymentId: payment.payment_id, redirectUrl: checkout.redirectUrl },
      { headers: corsHeaders },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur inattendue.";
    return Response.json(
      { error: message },
      { status: 400, headers: corsHeaders },
    );
  }
});
