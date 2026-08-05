function requireExactValue(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} ne correspond pas à l’exécution préparée.`);
  }
}

function requireSafeCents(value, label) {
  const normalized = Number(value);

  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`${label} est invalide.`);
  }

  return normalized;
}

export function authorizeLiveExecutionConfirmation({
  confirmation,
  expected,
  now = new Date(),
}) {
  if (!confirmation || typeof confirmation !== "object") {
    throw new Error("Une confirmation renforcée est obligatoire.");
  }

  if (!expected || typeof expected !== "object") {
    throw new Error("Le contexte d’exécution attendu est obligatoire.");
  }

  requireExactValue(
    confirmation.provisioning_job_id,
    expected.provisioningJobId,
    "Le provisionnement confirmé",
  );
  requireExactValue(confirmation.club_id, expected.clubId, "Le club confirmé");
  requireExactValue(
    confirmation.plan_set_key,
    expected.planSetKey,
    "Le jeu de plans confirmé",
  );
  requireExactValue(
    confirmation.currency,
    expected.currency,
    "La devise confirmée",
  );
  requireExactValue(
    requireSafeCents(confirmation.one_time_cents, "Le coût ponctuel confirmé"),
    requireSafeCents(expected.oneTimeCents, "Le coût ponctuel attendu"),
    "Le coût ponctuel confirmé",
  );
  requireExactValue(
    requireSafeCents(confirmation.monthly_cents, "Le coût mensuel confirmé"),
    requireSafeCents(expected.monthlyCents, "Le coût mensuel attendu"),
    "Le coût mensuel confirmé",
  );
  requireExactValue(
    Number(confirmation.current_plan_count),
    Number(expected.currentPlanCount),
    "Le nombre de plans confirmé",
  );

  const confirmedBy = String(confirmation.confirmed_by || "").trim();
  const confirmationId = String(confirmation.confirmation_id || "").trim();
  const expiresAt = new Date(confirmation.expires_at);

  if (!confirmationId || !confirmedBy) {
    throw new Error("La confirmation renforcée est incomplète.");
  }

  if (Number.isNaN(expiresAt.getTime())) {
    throw new Error("La date d’expiration de la confirmation est invalide.");
  }

  if (expiresAt.getTime() <= now.getTime()) {
    throw new Error("La confirmation renforcée a expiré.");
  }

  return Object.freeze({
    authorized: true,
    confirmationId,
    confirmedBy,
    planSetKey: confirmation.plan_set_key,
    expiresAt: expiresAt.toISOString(),
  });
}
