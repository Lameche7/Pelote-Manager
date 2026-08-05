import { runOnce } from "../workers/platform-provisioner/runOnce.mjs";

const SIMULATION_ACK = "I_UNDERSTAND_NO_RESOURCES_ARE_CREATED";

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function normalizeBaseUrl(value) {
  if (!value) throw new HttpError(503, "PLATFORM_SUPABASE_URL manque côté serveur.");
  return new URL(value).toString().replace(/\/$/, "");
}

function readBearerToken(request) {
  const authorization = request.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new HttpError(401, "Session centrale absente.");
  return match[1];
}

async function assertPlatformAdmin(request, env, fetchImpl = fetch) {
  const platformUrl = normalizeBaseUrl(env.PLATFORM_SUPABASE_URL);
  const serviceRoleKey = env.PLATFORM_SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new HttpError(
      503,
      "PLATFORM_SUPABASE_SERVICE_ROLE_KEY manque côté serveur.",
    );
  }

  const accessToken = readBearerToken(request);
  const response = await fetchImpl(
    `${platformUrl}/rest/v1/rpc/platform_is_admin`,
    {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: "{}",
    },
  );

  if (!response.ok) {
    throw new HttpError(401, "Session centrale invalide ou expirée.");
  }

  const isAdmin = await response.json();
  if (isAdmin !== true) {
    throw new HttpError(403, "Ce compte n’est pas super administrateur.");
  }
}

function renderPage() {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Simulation Pelote Manager</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 760px; margin: 48px auto; padding: 0 20px; color: #17201d; background: #f4f7f5; }
    main { background: white; border: 1px solid #d9e2dd; border-radius: 18px; padding: 28px; box-shadow: 0 18px 45px rgba(18, 42, 31, .08); }
    h1 { margin-top: 0; }
    button { border: 0; border-radius: 10px; padding: 12px 18px; font-weight: 700; cursor: pointer; background: #2453dc; color: white; }
    button:disabled { opacity: .6; cursor: wait; }
    pre { white-space: pre-wrap; background: #eef3f0; padding: 16px; border-radius: 10px; min-height: 54px; }
    .warning { color: #7a5300; background: #fff4ce; padding: 12px; border-radius: 10px; }
    a { color: #164dc8; }
  </style>
</head>
<body>
  <main>
    <p><strong>PELOTE MANAGER · SIMULATION PR43</strong></p>
    <h1>Étape suivante du provisionnement fictif</h1>
    <p class="warning">Cette page ne peut traiter que les clubs dont l’identifiant commence par <code>simulation-</code>. Aucun projet Supabase ou Vercel réel n’est créé.</p>
    <p>Reste connecté à la plateforme propriétaire dans ce même navigateur, puis clique une fois par étape.</p>
    <button id="run" type="button">Exécuter la prochaine étape simulée</button>
    <pre id="result">Prêt.</pre>
    <p><a href="/super-admin">Retour au tableau de bord</a></p>
  </main>
  <script>
    const button = document.getElementById("run");
    const result = document.getElementById("result");

    function findAccessToken(value, depth = 0) {
      if (!value || depth > 6) return null;
      if (typeof value === "object") {
        if (typeof value.access_token === "string") return value.access_token;
        for (const nested of Object.values(value)) {
          const token = findAccessToken(nested, depth + 1);
          if (token) return token;
        }
      }
      return null;
    }

    function readPlatformToken() {
      const preferred = localStorage.getItem("pelote-manager-platform-auth");
      const values = preferred ? [preferred] : [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key && key.includes("pelote-manager-platform-auth")) {
          const value = localStorage.getItem(key);
          if (value && !values.includes(value)) values.push(value);
        }
      }

      for (const raw of values) {
        try {
          const token = findAccessToken(JSON.parse(raw));
          if (token) return token;
        } catch {}
      }
      return null;
    }

    button.addEventListener("click", async () => {
      const token = readPlatformToken();
      if (!token) {
        result.textContent = "Session introuvable. Retourne sur /super-admin/connexion et reconnecte-toi.";
        return;
      }

      button.disabled = true;
      result.textContent = "Exécution en cours…";
      try {
        const response = await fetch(location.pathname, {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `Erreur HTTP ${response.status}`);
        result.textContent = payload.result
          ? `Étape terminée : ${payload.result.currentStep} (${payload.result.status}).`
          : "Aucune étape de simulation n’est actuellement en attente.";
      } catch (error) {
        result.textContent = error instanceof Error ? error.message : "Erreur inconnue.";
      } finally {
        button.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

export default async function handler(request, response) {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");

  if (request.method === "GET") {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.status(200).send(renderPage());
    return;
  }

  if (request.method !== "POST") {
    response.setHeader("allow", "GET, POST");
    response.status(405).json({ error: "Méthode non autorisée." });
    return;
  }

  try {
    await assertPlatformAdmin(request, process.env);

    const result = await runOnce({
      env: {
        PLATFORM_SUPABASE_URL: process.env.PLATFORM_SUPABASE_URL,
        PLATFORM_SUPABASE_SERVICE_ROLE_KEY:
          process.env.PLATFORM_SUPABASE_SERVICE_ROLE_KEY,
        PLATFORM_PROVISIONER_WORKER_ID: `vercel-simulation-${Date.now()}`,
        PLATFORM_PROVISIONER_LEASE_SECONDS: "180",
        PLATFORM_PROVISIONER_MODE: "simulation",
        PLATFORM_PROVISIONER_SIMULATION_ACK: SIMULATION_ACK,
        PLATFORM_PROVISIONER_SIMULATION_SLUG_PREFIX: "simulation-",
        PLATFORM_PROVISIONER_APPLICATION_VERSION:
          process.env.PLATFORM_PROVISIONER_APPLICATION_VERSION ||
          "0.0.0-pr43-simulation",
      },
    });

    response.status(200).json({ result });
  } catch (error) {
    const statusCode =
      error instanceof HttpError && Number.isInteger(error.statusCode)
        ? error.statusCode
        : 500;
    response.status(statusCode).json({
      error:
        error instanceof Error
          ? error.message
          : "Le worker de simulation a échoué.",
    });
  }
}
