// Server-only bridge between the independent platform and club Supabase projects.
// A centrally authenticated super admin can review onboarding requests without
// exposing the club project's service-role key to the browser.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["pending", "contacted", "approved", "rejected"]);
const COLUMNS =
  "id,club_name,city,contact_name,contact_email,contact_phone,requested_plan,status,created_at,reviewed_at,platform_club_id";

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requiredEnv(env, key) {
  const value = env[key]?.trim();
  if (!value)
    throw new HttpError(503, "Service des candidatures non configuré.");
  return value;
}

async function verifyPlatformAdmin(request, env, fetchImpl = fetch) {
  const platformUrl = requiredEnv(env, "VITE_PLATFORM_SUPABASE_URL");
  const platformKey = requiredEnv(env, "VITE_PLATFORM_SUPABASE_ANON_KEY");
  const bearer = request.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
  if (!bearer) throw new HttpError(401, "Connexion Super Admin requise.");

  const headers = {
    apikey: platformKey,
    authorization: `Bearer ${bearer}`,
  };
  const userResponse = await fetchImpl(`${platformUrl}/auth/v1/user`, {
    headers,
    cache: "no-store",
  });
  if (!userResponse.ok) throw new HttpError(401, "Session expirée.");
  const user = await userResponse.json();
  if (!UUID_RE.test(user?.id ?? "")) {
    throw new HttpError(401, "Session invalide.");
  }

  const adminResponse = await fetchImpl(
    `${platformUrl}/rest/v1/rpc/platform_is_admin`,
    {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: "{}",
      cache: "no-store",
    },
  );
  if (!adminResponse.ok || (await adminResponse.json()) !== true) {
    throw new HttpError(403, "Accès réservé au Super Administrateur.");
  }
  return user.id;
}

async function querySource(env, endpoint, init = {}, fetchImpl = fetch) {
  const sourceUrl = requiredEnv(env, "VITE_SUPABASE_URL");
  const serviceKey = requiredEnv(env, "NETWORK_REGISTRATION_SERVICE_ROLE_KEY");
  // sb_secret_* keys are opaque API keys, never bearer JWTs.
  const response = await fetchImpl(`${sourceUrl}/rest/v1/${endpoint}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new HttpError(502, "La base des candidatures est indisponible.");
  }
  return response.json();
}

function buildClubSlug(name, requestId) {
  const base = name
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50)
    .replace(/-$/g, "");
  return `${base || "club"}-${requestId.slice(0, 8)}`;
}

async function acceptApplication(env, request, id, actorId) {
  const platformUrl = requiredEnv(env, "VITE_PLATFORM_SUPABASE_URL");
  const platformKey = requiredEnv(env, "VITE_PLATFORM_SUPABASE_ANON_KEY");
  const token = request.headers.authorization.match(/^Bearer (\\S+)$/i)?.[1];
  if (!token) throw new HttpError(401, "Session Super Admin requise.");

  // Source data is read from the private DB. Never trust names, plan or email
  // submitted by the browser when creating the commercial registry record.
  const existing = await querySource(
    env,
    `network_club_registration_requests?id=eq.${id}&select=${COLUMNS}`,
  );
  if (!Array.isArray(existing) || existing.length !== 1) {
    throw new HttpError(404, "Demande introuvable.");
  }
  const application = existing[0];
  if (application.status === "approved" && application.platform_club_id) {
    return application;
  }
  if (application.status === "approved") {
    throw new HttpError(409, "Demande déjà acceptée sans rattachement. Vérification manuelle requise.");
  }
  if (!["essentiel", "club", "premium"].includes(application.requested_plan)) {
    throw new HttpError(409, "Formule de la candidature inconnue.");
  }

  const centralResponse = await fetch(
    `${platformUrl}/rest/v1/rpc/platform_register_network_application`,
    {
      method: "POST",
      headers: {
        apikey: platformKey,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        target_request_id: application.id,
        target_name: application.club_name,
        target_slug: buildClubSlug(application.club_name, application.id),
        target_contact_email: application.contact_email,
        target_plan: application.requested_plan,
        target_notes: `Candidature Pilotoki Network · ${application.city} · ${application.contact_name}`,
      }),
      cache: "no-store",
    },
  );

  if (!centralResponse.ok) {
    // Do not change source status if the central transaction fails.
    throw new HttpError(
      502,
      "La fiche centrale n'a pas pu être créée. Vérifiez que la migration centrale est installée.",
    );
  }
  const centralClubId = await centralResponse.json();
  if (typeof centralClubId !== "string" || !UUID_RE.test(centralClubId)) {
    throw new HttpError(502, "Réponse de la plateforme centrale invalide.");
  }

  // If the source PATCH fails after central commit, retrying invokes the
  // idempotent central RPC and gets the same club ID.
  const updated = await querySource(
    env,
    `network_club_registration_requests?id=eq.${id}&status=neq.approved&select=${COLUMNS}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        status: "approved",
        platform_club_id: centralClubId,
        reviewed_at: new Date().toISOString(),
        reviewed_by_platform_user_id: actorId,
      }),
    },
  );
  if (!Array.isArray(updated) || updated.length !== 1) {
    throw new HttpError(409, "Fiche créée, mais état de la candidature modifié. Actualisez.");
  }
  return updated[0];
}

export default async function handler(request, response) {
  response.setHeader("cache-control", "no-store, private");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("vary", "Authorization");

  if (request.method !== "GET" && request.method !== "POST") {
    response.setHeader("allow", "GET, POST");
    return response.status(405).json({ error: "Méthode non autorisée." });
  }

  try {
    // Every operation checks both the real Supabase Auth session and
    // the live platform_admins allowlist, never user_metadata claims.
    const actorId = await verifyPlatformAdmin(request, process.env);

    if (request.method === "GET") {
      const rows = await querySource(
        process.env,
        `network_club_registration_requests?select=${COLUMNS}&order=created_at.desc&limit=100`,
      );
      return response.status(200).json({ requests: rows });
    }

    const payload =
      typeof request.body === "string"
        ? JSON.parse(request.body)
        : request.body;
    const id = payload?.id;
    const status = payload?.status;
    if (!UUID_RE.test(id ?? "") || !STATUSES.has(status)) {
      throw new HttpError(400, "Décision invalide.");
    }

    if (status === "approved") {
      const approved = await acceptApplication(process.env, request, id, actorId);
      return response.status(200).json({ request: approved });
    }

    const rows = await querySource(
      process.env,
      `network_club_registration_requests?id=eq.${id}&status=neq.approved&select=${COLUMNS}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          status,
          reviewed_at: status === "pending" ? null : new Date().toISOString(),
          reviewed_by_platform_user_id: status === "pending" ? null : actorId,
        }),
      },
    );
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw new HttpError(409, "Demande déjà acceptée ou introuvable.");
    }
    return response.status(200).json({ request: rows[0] });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message =
      error instanceof HttpError
        ? error.message
        : "Impossible de traiter la demande.";
    return response.status(status).json({ error: message });
  }
}
