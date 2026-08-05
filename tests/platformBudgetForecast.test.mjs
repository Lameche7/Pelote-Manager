import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  buildPlatformBudgetForecasts,
  buildPlatformBudgetTotals,
} from "../.test-dist/src/features/platform/budget/platformBudgetForecast.js";

const dashboard = fs.readFileSync(
  "src/features/platform/pages/PlatformDashboardPage.tsx",
  "utf8",
);
const panel = fs.readFileSync(
  "src/features/platform/components/PlatformBudgetForecastPanel.tsx",
  "utf8",
);

function createPlan(overrides = {}) {
  return {
    id: "cost-plan-1",
    planId: "plan_1234567890abcdef12345678",
    provisioningJobId: "job-1",
    clubId: "club-1",
    provider: "supabase",
    step: "supabase_project",
    action: "create_project",
    createsBillableResource: true,
    currency: "EUR",
    oneTimeCents: 500,
    monthlyCents: 1_000,
    publicSummary: "Créer un projet isolé.",
    status: "pending",
    approvedAt: "",
    approvalExpiresAt: "",
    createdAt: "2026-08-05T07:00:00.000Z",
    ...overrides,
  };
}

test("la prévision additionne seulement les plans courants", () => {
  const forecasts = buildPlatformBudgetForecasts(
    [
      createPlan(),
      createPlan({
        id: "cost-plan-2",
        planId: "plan_abcdef1234567890abcdef12",
        provider: "vercel",
        step: "vercel_project",
        oneTimeCents: 200,
        monthlyCents: 300,
        status: "approved",
      }),
      createPlan({
        id: "cost-plan-old",
        planId: "plan_000000000000000000000000",
        oneTimeCents: 9_999,
        monthlyCents: 9_999,
        status: "superseded",
      }),
    ],
    new Date("2026-08-05T09:00:00.000Z"),
  );

  assert.equal(forecasts.length, 1);
  assert.deepEqual(forecasts[0], {
    clubId: "club-1",
    currency: "EUR",
    forecastMonth: "2026-08",
    oneTimeTotalCents: 700,
    monthlyTotalCents: 1_300,
    clearedOneTimeCents: 200,
    clearedMonthlyCents: 300,
    pendingOneTimeCents: 500,
    pendingMonthlyCents: 1_000,
    currentPlanCount: 2,
    billablePlanCount: 2,
    pendingApprovalCount: 1,
  });
});

test("une étape non facturable est considérée autorisée sans approbation", () => {
  const [forecast] = buildPlatformBudgetForecasts([
    createPlan({
      createsBillableResource: false,
      status: "pending",
      oneTimeCents: 0,
      monthlyCents: 0,
    }),
  ]);

  assert.equal(forecast.billablePlanCount, 0);
  assert.equal(forecast.pendingApprovalCount, 0);
  assert.equal(forecast.pendingMonthlyCents, 0);
});

test("les clubs et devises restent strictement séparés", () => {
  const forecasts = buildPlatformBudgetForecasts([
    createPlan(),
    createPlan({
      id: "cost-plan-2",
      planId: "plan_abcdef1234567890abcdef12",
      clubId: "club-2",
      currency: "USD",
      monthlyCents: 2_000,
    }),
  ]);
  const totals = buildPlatformBudgetTotals(forecasts);

  assert.equal(forecasts.length, 2);
  assert.deepEqual(
    totals.map((total) => [total.currency, total.monthlyTotalCents]),
    [
      ["EUR", 1_000],
      ["USD", 2_000],
    ],
  );
});

test("le super admin affiche une projection et jamais une facture", () => {
  assert.match(dashboard, /PlatformBudgetForecastPanel/);
  assert.match(panel, /Prévision budgétaire mensuelle/);
  assert.match(panel, /n’est ni une facture ni une autorisation de dépense/);
  assert.match(panel, /ne sont jamais\s+converties automatiquement/);
  assert.doesNotMatch(
    panel,
    /service_role|access_token|personal_access_token/i,
  );
});
