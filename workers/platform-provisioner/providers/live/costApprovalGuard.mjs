export const LIVE_COST_APPROVAL_ACK =
  "I_APPROVE_THE_DECLARED_PROVIDER_COSTS";

function normalizeBudgetCents(value, label) {
  const normalized = Number(value);

  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`${label} doit être un entier positif ou nul en centimes.`);
  }

  return normalized;
}

function requireNonEmptyString(value, label) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    throw new Error(`${label} est obligatoire.`);
  }

  return normalized;
}

export function createLiveCostPolicy({
  currency,
  maxOneTimeCents,
  maxMonthlyCents,
}) {
  return Object.freeze({
    currency: requireNonEmptyString(currency, "La devise budgétaire").toUpperCase(),
    maxOneTimeCents: normalizeBudgetCents(
      maxOneTimeCents,
      "Le plafond ponctuel",
    ),
    maxMonthlyCents: normalizeBudgetCents(
      maxMonthlyCents,
      "Le plafond mensuel",
    ),
  });
}

export function authorizeLiveStepPlan({
  plan,
  policy,
  approval,
  now = new Date(),
}) {
  if (!plan?.planId || !plan?.estimatedCost) {
    throw new Error("Le plan fournisseur chiffré est obligatoire.");
  }

  if (!policy?.currency) {
    throw new Error("La politique budgétaire serveur est obligatoire.");
  }

  if (plan.estimatedCost.currency !== policy.currency) {
    throw new Error(
      `La devise du plan ${plan.estimatedCost.currency} ne correspond pas à ${policy.currency}.`,
    );
  }

  if (plan.estimatedCost.oneTimeCents > policy.maxOneTimeCents) {
    throw new Error("Le coût ponctuel estimé dépasse le plafond autorisé.");
  }

  if (plan.estimatedCost.monthlyCents > policy.maxMonthlyCents) {
    throw new Error("Le coût mensuel estimé dépasse le plafond autorisé.");
  }

  if (!plan.createsBillableResource) {
    return Object.freeze({
      authorized: true,
      approvalRequired: false,
      planId: plan.planId,
    });
  }

  if (!approval || typeof approval !== "object") {
    throw new Error("Une approbation explicite du coût est obligatoire.");
  }

  if (approval.acknowledgement !== LIVE_COST_APPROVAL_ACK) {
    throw new Error("L’approbation du coût ne contient pas la confirmation attendue.");
  }

  if (approval.planId !== plan.planId) {
    throw new Error("L’approbation ne correspond pas exactement au plan courant.");
  }

  const approvedBy = requireNonEmptyString(
    approval.approvedBy,
    "L’auteur de l’approbation",
  );
  const expiresAt = new Date(approval.expiresAt);

  if (Number.isNaN(expiresAt.getTime())) {
    throw new Error("La date d’expiration de l’approbation est invalide.");
  }

  if (expiresAt.getTime() <= now.getTime()) {
    throw new Error("L’approbation du coût a expiré.");
  }

  return Object.freeze({
    authorized: true,
    approvalRequired: true,
    planId: plan.planId,
    approvedBy,
    expiresAt: expiresAt.toISOString(),
  });
}
