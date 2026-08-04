export const PROVISIONING_STEPS = Object.freeze([
  "requested",
  "supabase_project",
  "database_migrations",
  "club_bootstrap",
  "first_admin",
  "vercel_project",
  "environment_variables",
  "deployment",
  "verification",
  "completed",
]);

const stepIndex = new Map(
  PROVISIONING_STEPS.map((step, index) => [step, index]),
);

export function assertProvisioningStep(step) {
  if (!stepIndex.has(step)) {
    throw new Error(`Étape de provisionnement inconnue : ${String(step)}`);
  }
}

export function nextProvisioningStep(step) {
  assertProvisioningStep(step);
  const index = stepIndex.get(step);
  return PROVISIONING_STEPS[Math.min(index + 1, PROVISIONING_STEPS.length - 1)];
}

export function createIdempotencyKey(jobId, step) {
  if (!jobId || typeof jobId !== "string") {
    throw new Error("L’identifiant du provisionnement est obligatoire.");
  }

  assertProvisioningStep(step);
  return `pelote-manager:${jobId}:${step}`;
}

export function sanitizeErrorMessage(error) {
  const rawMessage = error instanceof Error ? error.message : String(error);

  return rawMessage
    .replace(/bearer\s+[a-z0-9._~-]+/gi, "Bearer [REDACTED]")
    .replace(
      /(service[_-]?role|api[_-]?key|token|password|secret)\s*[:=]\s*\S+/gi,
      "$1=[REDACTED]",
    )
    .slice(0, 500);
}

export function sanitizeProviderReferences(references = {}) {
  const allowedKeys = new Set([
    "supabaseProjectRef",
    "supabaseUrl",
    "vercelProjectName",
    "deploymentUrl",
    "currentVersion",
  ]);
  const sanitized = {};

  for (const [key, value] of Object.entries(references)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Référence technique interdite : ${key}`);
    }

    if (value !== null && value !== undefined && typeof value !== "string") {
      throw new Error(`La référence ${key} doit être une chaîne.`);
    }

    sanitized[key] = value?.trim() || null;
  }

  return sanitized;
}
