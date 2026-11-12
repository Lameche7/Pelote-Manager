import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = "https://app.pelotemanager.fr";

function headers(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  const allowed = new Set(
    [allowedOrigin, ...(Deno.env.get("PLATFORM_ALLOWED_ORIGINS") ?? "").split(",")]
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return {
    "Access-Control-Allow-Origin":
      origin && allowed.has(origin) ? origin : allowedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-business-authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

function respond(request: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers(request), "Content-Type": "application/json" },
  });
}

function bearer(header: string | null): string | null {
  return /^Bearer ([^\\s]+)$/.exec(header ?? "")?.[1] ?? null;
}

/**
 * Proves that two independently authenticated sessions belong to the same
 * verified email address and that the platform identity is a super-admin.
 * Does NOT grant business permissions or perform business mutations.
 * Deploy on PLATFORM with verify_jwt=true.
 */
Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: headers(request) });
  }
  if (request.method !== "POST") {
    return respond(request, 405, { error: "Méthode non autorisée" });
  }

  const platformToken = bearer(request.headers.get("Authorization"));
  const businessToken = bearer(request.headers.get("X-Business-Authorization"));
  if (!platformToken || !businessToken) {
    return respond(request, 401, { linked: false });
  }

  const platformUrl = Deno.env.get("SUPABASE_URL");
  const platformKey = Deno.env.get("SUPABASE_ANON_KEY");
  const businessUrl = Deno.env.get("BUSINESS_SUPABASE_URL");
  const businessKey = Deno.env.get("BUSINESS_SUPABASE_SERVICE_ROLE_KEY");
  if (!platformUrl || !platformKey || !businessUrl || !businessKey) {
    return respond(request, 503, { error: "Service indisponible" });
  }

  try {
    const platform = createClient(platformUrl, platformKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: { Authorization: `Bearer ${platformToken}` },
      },
    });
    const business = createClient(businessUrl, businessKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const [platformIdentity, businessIdentity] = await Promise.all([
      platform.auth.getUser(platformToken),
      business.auth.getUser(businessToken),
    ]);
    const platformUser = platformIdentity.data.user;
    const businessUser = businessIdentity.data.user;
    if (
      platformIdentity.error ||
      businessIdentity.error ||
      !platformUser ||
      !businessUser
    ) {
      return respond(request, 401, { linked: false });
    }

    const { data: isAdmin, error: roleError } =
      await platform.rpc("platform_is_admin");
    if (roleError || isAdmin !== true) {
      return respond(request, 403, { linked: false });
    }

    const platformEmail = platformUser.email?.trim().toLowerCase();
    const businessEmail = businessUser.email?.trim().toLowerCase();
    const bothVerified =
      Boolean(platformUser.email_confirmed_at) &&
      Boolean(businessUser.email_confirmed_at);
    if (!bothVerified || !platformEmail || platformEmail !== businessEmail) {
      return respond(request, 403, { linked: false });
    }

    return respond(request, 200, {
      linked: true,
      businessUserId: businessUser.id,
      // Explicitly not a grant to administer another club.
      crossClubAdministrationEnabled: false,
    });
  } catch (error) {
    console.error("platform-business-identity verification failed", error);
    return respond(request, 500, { linked: false });
  }
});
