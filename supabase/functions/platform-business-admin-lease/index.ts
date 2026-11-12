import { createClient } from "npm:@supabase/supabase-js@2";

const defaultOrigin = "https://app.pelotemanager.fr";

function cors(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  const allowed = new Set(
    [
      defaultOrigin,
      ...(Deno.env.get("PLATFORM_ALLOWED_ORIGINS") ?? "").split(","),
    ]
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return {
    "Access-Control-Allow-Origin":
      origin && allowed.has(origin) ? origin : defaultOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-business-authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

function reply(request: Request, status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(request), "Content-Type": "application/json" },
  });
}

function bearer(value: string | null): string | null {
  return /^Bearer ([^\s]+)$/.exec(value ?? "")?.[1] ?? null;
}

/**
 * PLATFORM-only, verify_jwt=true. Never deploy before the business SQL
 * migration has been reviewed and tested in an isolated environment.
 * The caller cannot choose a user id, permissions, or lease duration.
 */
Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(request) });
  }
  if (request.method !== "POST" && request.method !== "DELETE") {
    return reply(request, 405, { error: "Méthode non autorisée" });
  }

  const platformToken = bearer(request.headers.get("Authorization"));
  const businessToken = bearer(request.headers.get("X-Business-Authorization"));
  if (!platformToken || !businessToken) {
    return reply(request, 401, { error: "Deux sessions requises" });
  }

  const platformUrl = Deno.env.get("SUPABASE_URL");
  const platformKey = Deno.env.get("SUPABASE_ANON_KEY");
  const businessUrl = Deno.env.get("BUSINESS_SUPABASE_URL");
  const businessKey = Deno.env.get("BUSINESS_SUPABASE_SERVICE_ROLE_KEY");
  if (!platformUrl || !platformKey || !businessUrl || !businessKey) {
    return reply(request, 503, { error: "Service indisponible" });
  }

  try {
    const platform = createClient(platformUrl, platformKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${platformToken}` } },
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
      return reply(request, 401, { error: "Session invalide" });
    }

    const { data: isAdmin, error: roleError } =
      await platform.rpc("platform_is_admin");
    // Revocation must remain possible after a platform role is removed.
    if (request.method === "POST" && (roleError || isAdmin !== true)) {
      return reply(request, 403, { error: "Super-admin requis" });
    }

    const platformEmail = platformUser.email?.trim().toLowerCase();
    const businessEmail = businessUser.email?.trim().toLowerCase();
    if (
      !platformUser.email_confirmed_at ||
      !businessUser.email_confirmed_at ||
      !platformEmail ||
      platformEmail !== businessEmail
    ) {
      return reply(request, 403, { error: "Identités non liées" });
    }

    const operation =
      request.method === "DELETE"
        ? "revoke_platform_admin_lease"
        : "issue_platform_admin_lease";
    const parameters =
      request.method === "DELETE"
        ? { target_business_user_id: businessUser.id }
        : { target_business_user_id: businessUser.id, requested_seconds: 300 };
    const { data, error } = await business.rpc(operation, parameters);
    if (error) throw error;

    return reply(
      request,
      200,
      request.method === "DELETE"
        ? { revoked: true }
        : { enabled: true, expiresAt: data },
    );
  } catch (error) {
    console.error("platform admin lease operation failed", error);
    return reply(request, 500, { error: "Autorisation indisponible" });
  }
});
