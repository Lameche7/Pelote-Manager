import assert from "node:assert/strict";
import test from "node:test";
import {
  LIVE_COST_APPROVAL_ACK,
  authorizeLiveStepPlan,
  createLiveCostPolicy,
} from "../workers/platform-provisioner/providers/live/costApprovalGuard.mjs";
import {
  assertLiveAdapter,
  createLiveStepPlan,
} from "../workers/platform-provisioner/providers/live/liveAdapterContract.mjs";
import {
  LIVE_PROVISIONING_DISABLED_MESSAGE,
  createLiveProvisioningPlanner,
} from "../workers/platform-provisioner/providers/live/liveProvisioningPlanner.mjs";

const context = Object.freeze({
  jobId: "job-live-contract",
  clubSlug: "club-contrat",
  step: "supabase_project",
  idempotencyKey: "pelote-manager:job-live-contract:supabase_project",
});

function createAdapter(name, planInput) {
  return {
    name,
    async planStep() {
      return planInput;
    },
    async applyStep() {
      throw new Error("Ne doit pas être appelé dans la PR43.");
    },
  };
}

function createBillablePlan(overrides = {}) {
  return createLiveStepPlan({
    adapterName: "supabase",
    context,
    action: "create_project",
    createsBillableResource: true,
    estimatedCost: {
      currency: "EUR",
      oneTimeCents: 0,
      monthlyCents: 1_000,
    },
    publicSummary: "Créer un projet Supabase isolé pour le club.",
    ...overrides,
  });
}

const policy = createLiveCostPolicy({
  currency: "EUR",
  maxOneTimeCents: 2_000,
  maxMonthlyCents: 2_500,
});

test("les adaptateurs réels doivent déclarer planification et application", () => {
  assert.equal(
    assertLiveAdapter(createAdapter("supabase", {}), "supabase").name,
    "supabase",
  );

  assert.throws(
    () => assertLiveAdapter({ name: "supabase", planStep() {} }, "supabase"),
    /applyStep/,
  );
  assert.throws(
    () => assertLiveAdapter(createAdapter("vercel", {}), "supabase"),
    /doit déclarer son nom/,
  );
});

test("un plan réel est chiffré, public et déterministe", () => {
  const firstPlan = createBillablePlan();
  const secondPlan = createBillablePlan();

  assert.equal(firstPlan.planId, secondPlan.planId);
  assert.equal(firstPlan.adapterName, "supabase");
  assert.equal(firstPlan.estimatedCost.currency, "EUR");
  assert.equal(firstPlan.estimatedCost.monthlyCents, 1_000);
  assert.equal(firstPlan.createsBillableResource, true);

  assert.throws(
    () =>
      createBillablePlan({
        adapterName: "vercel",
      }),
    /doit être planifiée par supabase/,
  );
});

test("une création payante exige une approbation exacte et non expirée", () => {
  const plan = createBillablePlan();
  const now = new Date("2026-08-05T08:00:00.000Z");

  assert.throws(
    () => authorizeLiveStepPlan({ plan, policy, approval: null, now }),
    /approbation explicite/,
  );

  const authorization = authorizeLiveStepPlan({
    plan,
    policy,
    now,
    approval: {
      acknowledgement: LIVE_COST_APPROVAL_ACK,
      planId: plan.planId,
      approvedBy: "platform-owner",
      expiresAt: "2026-08-05T09:00:00.000Z",
    },
  });

  assert.deepEqual(authorization, {
    authorized: true,
    approvalRequired: true,
    planId: plan.planId,
    approvedBy: "platform-owner",
    expiresAt: "2026-08-05T09:00:00.000Z",
  });
});

test("une approbation ancienne ou prévue pour un autre plan est refusée", () => {
  const plan = createBillablePlan();
  const now = new Date("2026-08-05T08:00:00.000Z");

  assert.throws(
    () =>
      authorizeLiveStepPlan({
        plan,
        policy,
        now,
        approval: {
          acknowledgement: LIVE_COST_APPROVAL_ACK,
          planId: "plan_autre",
          approvedBy: "platform-owner",
          expiresAt: "2026-08-05T09:00:00.000Z",
        },
      }),
    /ne correspond pas exactement/,
  );

  assert.throws(
    () =>
      authorizeLiveStepPlan({
        plan,
        policy,
        now,
        approval: {
          acknowledgement: LIVE_COST_APPROVAL_ACK,
          planId: plan.planId,
          approvedBy: "platform-owner",
          expiresAt: "2026-08-05T07:59:59.000Z",
        },
      }),
    /a expiré/,
  );
});

test("les plafonds et la devise sont contrôlés avant toute création", () => {
  assert.throws(
    () =>
      authorizeLiveStepPlan({
        plan: createBillablePlan({
          estimatedCost: {
            currency: "EUR",
            oneTimeCents: 0,
            monthlyCents: 3_000,
          },
        }),
        policy,
        approval: {},
      }),
    /coût mensuel estimé dépasse/,
  );

  assert.throws(
    () =>
      authorizeLiveStepPlan({
        plan: createBillablePlan({
          estimatedCost: {
            currency: "USD",
            oneTimeCents: 0,
            monthlyCents: 1_000,
          },
        }),
        policy,
        approval: {},
      }),
    /devise du plan USD/,
  );
});

test("une étape sans création de ressource ne demande pas d’approbation", () => {
  const plan = createLiveStepPlan({
    adapterName: "supabase",
    context: {
      ...context,
      step: "database_migrations",
      idempotencyKey: "pelote-manager:job-live-contract:database_migrations",
    },
    action: "apply_migrations",
    createsBillableResource: false,
    estimatedCost: {
      currency: "EUR",
      oneTimeCents: 0,
      monthlyCents: 0,
    },
    publicSummary: "Appliquer les migrations validées.",
  });

  assert.deepEqual(authorizeLiveStepPlan({ plan, policy }), {
    authorized: true,
    approvalRequired: false,
    planId: plan.planId,
  });
});

test("le planificateur prépare et autorise mais ne peut rien exécuter", async () => {
  const supabaseAdapter = createAdapter("supabase", {
    action: "create_project",
    createsBillableResource: true,
    estimatedCost: {
      currency: "EUR",
      oneTimeCents: 0,
      monthlyCents: 1_000,
    },
    publicSummary: "Créer le projet Supabase isolé.",
  });
  const vercelAdapter = createAdapter("vercel", {
    action: "create_project",
    createsBillableResource: true,
    estimatedCost: {
      currency: "EUR",
      oneTimeCents: 0,
      monthlyCents: 0,
    },
    publicSummary: "Créer le projet Vercel isolé.",
  });
  const planner = createLiveProvisioningPlanner({
    supabaseAdapter,
    vercelAdapter,
    costPolicy: policy,
  });
  const plan = await planner.planStep(context);

  assert.equal(planner.mode, "live-planning-only");
  assert.match(plan.planId, /^plan_[a-f0-9]{24}$/);
  await assert.rejects(
    () => planner.applyPlan(plan),
    new RegExp(
      LIVE_PROVISIONING_DISABLED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    ),
  );
});
