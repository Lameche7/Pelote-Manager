import { createClient } from "npm:@supabase/supabase-js@2.110.5";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-pelote-push-secret",
};

type WebhookPayload = {
  type?: string;
  table?: string;
  schema?: string;
  record?: { id?: string } | null;
  old_record?: { id?: string } | null;
  communicationId?: string;
};

type PushSubscriptionRow = {
  id: string;
  profile_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  is_active: boolean;
};

type DeliveryRow = {
  id: string;
  profile_id_at_publication: string | null;
};

type AttemptRow = {
  id: string;
  delivery_id: string;
  subscription_id: string;
  status: "pending" | "sent" | "failed" | "invalid";
  attempt_count: number;
};

const toErrorDetails = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return {
      message: "Erreur Web Push inconnue",
      statusCode: null as number | null,
    };
  }

  const candidate = error as { message?: string; statusCode?: number };
  return {
    message: candidate.message ?? "Erreur Web Push inconnue",
    statusCode: candidate.statusCode ?? null,
  };
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return Response.json(
      { error: "Méthode non autorisée" },
      { status: 405, headers: corsHeaders },
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const vapidPublicKey = Deno.env.get("WEB_PUSH_VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("WEB_PUSH_VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("WEB_PUSH_VAPID_SUBJECT");
    const webhookSecret = Deno.env.get("WEB_PUSH_WEBHOOK_SECRET");

    if (
      !supabaseUrl ||
      !serviceRoleKey ||
      !vapidPublicKey ||
      !vapidPrivateKey ||
      !vapidSubject ||
      !webhookSecret
    ) {
      throw new Error("Configuration Web Push incomplète.");
    }

    if (request.headers.get("x-pelote-push-secret") !== webhookSecret) {
      return Response.json(
        { error: "Accès refusé" },
        { status: 401, headers: corsHeaders },
      );
    }

    const payload = (await request.json()) as WebhookPayload;
    const communicationId =
      payload.communicationId ?? payload.record?.id ?? payload.old_record?.id;

    if (!communicationId) {
      throw new Error("Identifiant de communication manquant.");
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: communication, error: communicationError } = await admin
      .from("club_communications")
      .select("id,title,body,priority,status,published_at,expires_at")
      .eq("id", communicationId)
      .maybeSingle();

    if (communicationError) throw communicationError;
    if (!communication || communication.status !== "published") {
      return Response.json(
        {
          communicationId,
          skipped: true,
          reason: "communication_not_published",
        },
        { headers: corsHeaders },
      );
    }

    if (
      communication.expires_at &&
      new Date(communication.expires_at).getTime() <= Date.now()
    ) {
      return Response.json(
        { communicationId, skipped: true, reason: "communication_expired" },
        { headers: corsHeaders },
      );
    }

    const { data: deliveries, error: deliveriesError } = await admin
      .from("communication_deliveries")
      .select("id,profile_id_at_publication")
      .eq("communication_id", communicationId)
      .not("profile_id_at_publication", "is", null);

    if (deliveriesError) throw deliveriesError;

    const typedDeliveries = (deliveries ?? []) as DeliveryRow[];
    const profileIds = [
      ...new Set(
        typedDeliveries
          .map((delivery) => delivery.profile_id_at_publication)
          .filter((profileId): profileId is string => Boolean(profileId)),
      ),
    ];

    if (profileIds.length === 0) {
      return Response.json(
        {
          communicationId,
          sent: 0,
          failed: 0,
          invalid: 0,
          recipientsWithPush: 0,
        },
        { headers: corsHeaders },
      );
    }

    const { data: subscriptions, error: subscriptionsError } = await admin
      .from("push_subscriptions")
      .select("id,profile_id,endpoint,p256dh,auth,is_active")
      .in("profile_id", profileIds)
      .eq("is_active", true);

    if (subscriptionsError) throw subscriptionsError;

    const typedSubscriptions = (subscriptions ?? []) as PushSubscriptionRow[];
    if (typedSubscriptions.length === 0) {
      return Response.json(
        {
          communicationId,
          sent: 0,
          failed: 0,
          invalid: 0,
          recipientsWithPush: 0,
        },
        { headers: corsHeaders },
      );
    }

    const { data: existingAttempts, error: attemptsError } = await admin
      .from("push_delivery_attempts")
      .select("id,delivery_id,subscription_id,status,attempt_count")
      .eq("communication_id", communicationId);

    if (attemptsError) throw attemptsError;

    const attemptsByPair = new Map<string, AttemptRow>();
    for (const attempt of (existingAttempts ?? []) as AttemptRow[]) {
      attemptsByPair.set(
        `${attempt.delivery_id}:${attempt.subscription_id}`,
        attempt,
      );
    }

    const deliveryByProfile = new Map<string, DeliveryRow>();
    for (const delivery of typedDeliveries) {
      if (delivery.profile_id_at_publication) {
        deliveryByProfile.set(delivery.profile_id_at_publication, delivery);
      }
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    const ttlSeconds = communication.expires_at
      ? Math.max(
          0,
          Math.min(
            86_400,
            Math.floor(
              (new Date(communication.expires_at).getTime() - Date.now()) /
                1000,
            ),
          ),
        )
      : 86_400;

    const notificationPayload = JSON.stringify({
      title: communication.title,
      body: communication.body,
      icon: "/pwa-icon.svg",
      badge: "/pwa-icon.svg",
      url: "/mon-espace/notifications",
      tag: `communication:${communication.id}`,
      priority: communication.priority,
    });

    let sent = 0;
    let failed = 0;
    let invalid = 0;

    for (const subscription of typedSubscriptions) {
      const delivery = deliveryByProfile.get(subscription.profile_id);
      if (!delivery) continue;

      const pairKey = `${delivery.id}:${subscription.id}`;
      const existingAttempt = attemptsByPair.get(pairKey);
      if (
        existingAttempt?.status === "sent" ||
        existingAttempt?.status === "invalid"
      ) {
        continue;
      }

      let attemptId = existingAttempt?.id;
      let attemptCount = existingAttempt?.attempt_count ?? 0;

      if (!attemptId) {
        const { data: createdAttempt, error: createAttemptError } = await admin
          .from("push_delivery_attempts")
          .insert({
            communication_id: communicationId,
            delivery_id: delivery.id,
            subscription_id: subscription.id,
            status: "pending",
          })
          .select("id,attempt_count")
          .single();

        if (createAttemptError) throw createAttemptError;
        attemptId = createdAttempt.id;
        attemptCount = Number(createdAttempt.attempt_count ?? 0);
      }

      try {
        const response = await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          notificationPayload,
          { TTL: ttlSeconds },
        );

        sent += 1;
        await Promise.all([
          admin
            .from("push_delivery_attempts")
            .update({
              status: "sent",
              attempt_count: attemptCount + 1,
              response_status: response.statusCode,
              error_message: null,
              last_attempt_at: new Date().toISOString(),
              sent_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", attemptId),
          admin
            .from("push_subscriptions")
            .update({
              last_success_at: new Date().toISOString(),
              last_error_at: null,
              last_error: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", subscription.id),
        ]);
      } catch (sendError) {
        const details = toErrorDetails(sendError);
        const isInvalid =
          details.statusCode === 404 || details.statusCode === 410;
        if (isInvalid) invalid += 1;
        else failed += 1;

        await Promise.all([
          admin
            .from("push_delivery_attempts")
            .update({
              status: isInvalid ? "invalid" : "failed",
              attempt_count: attemptCount + 1,
              response_status: details.statusCode,
              error_message: details.message,
              last_attempt_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", attemptId),
          admin
            .from("push_subscriptions")
            .update({
              is_active: isInvalid ? false : true,
              last_error_at: new Date().toISOString(),
              last_error: details.message,
              updated_at: new Date().toISOString(),
            })
            .eq("id", subscription.id),
        ]);
      }
    }

    return Response.json(
      {
        communicationId,
        sent,
        failed,
        invalid,
        recipientsWithPush: typedSubscriptions.length,
      },
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
