import { createClient } from "npm:@supabase/supabase-js@2";

type Club = { id: string; name: string; slug: string };

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Vary": "Origin",
    },
  });
}

/**
 * Déployer uniquement sur le projet PLATEFORME avec verify_jwt activé.
 * La clé service_role métier reste dans les secrets de l'Edge Function.
 * Cette route est strictement en lecture seule.
 */
Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "GET") {
    return json(405, { error: "Méthode non autorisée" });
  }

  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer ([^\s]+)$/.exec(header);
  if (!match) return json(401, { error: "Authentification requise" });

  const platformUrl = Deno.env.get("SUPABASE_URL");
  const platformAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const businessUrl = Deno.env.get("BUSINESS_SUPABASE_URL");
  const businessServiceKey = Deno.env.get(
    "BUSINESS_SUPABASE_SERVICE_ROLE_KEY",
  );

  if (!platformUrl || !platformAnonKey || !businessUrl || !businessServiceKey) {
    return json(503, { error: "Service indisponible" });
  }

  try {
    // Ne jamais accepter l'identité ou le rôle dans les paramètres client.
    const platform = createClient(platformUrl, platformAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: header } },
    });
    const { data: identity, error: identityError } =
      await platform.auth.getUser(match[1]);
    if (identityError || !identity.user) {
      return json(401, { error: "Session invalide" });
    }

    const { data: isAdmin, error: roleError } =
      await platform.rpc("platform_is_admin");
    if (roleError || isAdmin !== true) {
      return json(403, { error: "Accès refusé" });
    }

    const business = createClient(businessUrl, businessServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await business
      .from("clubs")
      .select("id,name,slug")
      .order("name");
    if (error) throw error;

    const clubs: Club[] = (data ?? []).map(({ id, name, slug }) => ({
      id,
      name,
      slug,
    }));
    return json(200, { clubs });
  } catch (error) {
    console.error("business-clubs-catalogue failed", error);
    return json(500, { error: "Erreur du service" });
  }
});
