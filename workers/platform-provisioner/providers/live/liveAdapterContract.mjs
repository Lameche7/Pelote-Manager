import { createHash } from "node:crypto";

export const LIVE_ADAPTER_NAMES = Object.freeze(["supabase", "vercel"]);

export const LIVE_STEP_ADAPTER = Object.freeze({
  supabase_project: "supabase",
  database_migrations: "supabase",
  club_bootstrap: "supabase",
  first_admin: "supabase",
  vercel_project: "vercel",
  environment_variables: "vercel",
  deployment: "vercel",
  verification: "vercel",
});

const LIVE_PLAN_ACTIONS = new Set([
  "create_project",
  "apply_migrations",
  "bootstrap_club",
  "attach_first_admin",
  "configure_project",
  "deploy_application",
  "verify_instance",
]);

function requireNonEmptyString(value, label) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    throw new Error(`${label} est obligatoire.`);
  }

  return normalized;
}

function normalizeCostCents(value, label) {
  const normalized = Number(value ?? 0);

  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`${label} doit être un nombre entier positif en centimes.`);
  }

  return normalized;
}

export function assertLiveAdapter(adapter, expectedName) {
  if (!LIVE_ADAPTER_NAMES.includes(expectedName)) {
    throw new Error(`Adaptateur réel inconnu : ${expectedName}.`);
  }

  if (!adapter || typeof adapter !== "object") {
    throw new Error(`L’adaptateur ${expectedName} est obligatoire.`);
  }

  if (adapter.name !== expectedName) {
    throw new Error(`L’adaptateur ${expectedName} doit déclarer son nom.`);
  }

  if (typeof adapter.planStep !== "function") {
    throw new Error(`L’adaptateur ${expectedName} doit exposer planStep.`);
  }

  if (typeof adapter.applyStep !== "function") {
    throw new Error(`L’adaptateur ${expectedName} doit exposer applyStep.`);
  }

  return adapter;
}

export function createLiveStepPlan({
  adapterName,
  context,
  action,
  createsBillableResource = false,
  estimatedCost = {},
  publicSummary,
}) {
  const expectedAdapter = LIVE_STEP_ADAPTER[context?.step];

  if (!expectedAdapter) {
    throw new Error(
      `Aucun adaptateur réel n’est défini pour l’étape ${String(context?.step)}.`,
    );
  }

  if (adapterName !== expectedAdapter) {
    throw new Error(
      `L’étape ${context.step} doit être planifiée par ${expectedAdapter}.`,
    );
  }

  const idempotencyKey = requireNonEmptyString(
    context.idempotencyKey,
    "La clé d’idempotence",
  );
  const normalizedAction = requireNonEmptyString(action, "L’action fournisseur");

  if (!LIVE_PLAN_ACTIONS.has(normalizedAction)) {
    throw new Error(`Action fournisseur interdite : ${normalizedAction}.`);
  }

  const currency = requireNonEmptyString(
    estimatedCost.currency,
    "La devise du coût estimé",
  ).toUpperCase();
  const oneTimeCents = normalizeCostCents(
    estimatedCost.oneTimeCents,
    "Le coût ponctuel estimé",
  );
  const monthlyCents = normalizeCostCents(
    estimatedCost.monthlyCents,
    "Le coût mensuel estimé",
  );

  const planPayload = {
    adapterName,
    step: context.step,
    idempotencyKey,
    action: normalizedAction,
    createsBillableResource: Boolean(createsBillableResource),
    estimatedCost: {
      currency,
      oneTimeCents,
      monthlyCents,
    },
  };
  const planId = `plan_${createHash("sha256")
    .update(JSON.stringify(planPayload))
    .digest("hex")
    .slice(0, 24)}`;

  return Object.freeze({
    planId,
    ...planPayload,
    publicSummary: requireNonEmptyString(
      publicSummary,
      "Le résumé public du plan",
    ),
  });
}
