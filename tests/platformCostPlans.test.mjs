import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createPlatformRegistryClient } from "../workers/platform-provisioner/platformRegistryClient.mjs";

const migration = fs.readFileSync(
  "supabase/platform/migrations/20260805010000_add_platform_cost_plans.sql",
  "utf8",
);
const registryService = fs.readFileSync(
  "src/features/platform/services/platformRegistryService.ts",
  "utf8",
);
const dashboard = fs.readFileSync(
  "src/features/platform/pages/PlatformDashboardPage.tsx",
  "utf8",
);
const costPlanList = fs.readFileSync(
  "src/features/platform/components/PlatformCostPlanList.tsx",
  "utf8",
);

function createMockResponse(payload = null) {
  return {
    ok: true,
    status: 200,
    async text() {
      return payload === null ? "" : JSON.stringify(payload);
    },
  };
}

test("les plans et approbations restent dans la plateforme centrale", () => {
  assert.match(
    migration,
    /create table if not exists public\.platform_cost_plans/,
  );
  assert.match(
    migration,
    /create table if not exists public\.platform_cost_plan_approvals/,
  );
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /platform admins read cost plans/);
  assert.match(migration, /platform admins read cost approvals/);
  assert.doesNotMatch(migration, /public\.club_members\b/);
  assert.doesNotMatch(migration, /public\.reservations\b/);
  assert.doesNotMatch(migration, /public\.payments\b/);
});

test("seul le worker serveur peut enregistrer un plan public", () => {
  assert.match(migration, /function public\.platform_worker_store_cost_plan/);
  assert.match(migration, /auth\.role\(\) <> 'service_role'/);

  const workerGrantStart = migration.indexOf(
    "grant execute on function public.platform_worker_store_cost_plan",
  );
  const workerGrantEnd = migration.indexOf(";", workerGrantStart);
  const workerGrant = migration.slice(workerGrantStart, workerGrantEnd + 1);

  assert.notEqual(workerGrantStart, -1);
  assert.match(workerGrant, /to service_role/);
  assert.doesNotMatch(workerGrant, /to authenticated/);
  assert.match(migration, /'cost_plan\.recorded'/);
});

test("un nouveau chiffrage remplace le précédent et révoque son approbation", () => {
  assert.match(
    migration,
    /platform_cost_plans_one_current_step_idx[\s\S]*where superseded_at is null/,
  );
  assert.match(
    migration,
    /set superseded_at = now\(\)[\s\S]*where provisioning_job_id = target_job_id/,
  );
  assert.match(
    migration,
    /revoke_reason = 'Plan remplacé par une nouvelle estimation'/,
  );
  assert.match(migration, /Le plan existe déjà avec un contenu différent/);
});

test("une approbation est réservée au super admin, limitée à une heure et auditée", () => {
  const approveStart = migration.indexOf(
    "function public.platform_approve_cost_plan",
  );
  const approveEnd = migration.indexOf("$$;", approveStart);
  const approveBody = migration.slice(approveStart, approveEnd + 3);

  assert.match(approveBody, /public\.is_platform_admin\(\)/);
  assert.match(approveBody, /now\(\) \+ interval '1 hour'/);
  assert.match(approveBody, /target_plan\.superseded_at is not null/);
  assert.match(approveBody, /target_plan\.creates_billable_resource/);
  assert.match(approveBody, /'cost_plan\.approved'/);
  assert.match(migration, /'cost_plan\.approval_revoked'/);
});

test("la lecture calcule les états approuvé, expiré, révoqué et remplacé", () => {
  assert.match(migration, /function public\.platform_list_cost_plans/);
  assert.match(migration, /then 'superseded'/);
  assert.match(migration, /then 'revoked'/);
  assert.match(migration, /then 'expired'/);
  assert.match(migration, /then 'approved'/);
  assert.match(migration, /else 'pending'/);
});

test("le super admin consulte, approuve et révoque sans secret serveur", () => {
  assert.match(registryService, /platform_list_cost_plans/);
  assert.match(registryService, /platform_approve_cost_plan/);
  assert.match(registryService, /platform_revoke_cost_plan_approval/);
  assert.match(dashboard, /de coût à examiner/);
  assert.match(costPlanList, /Approuver pour une heure/);
  assert.match(
    costPlanList,
    /Aucune approbation ne déclenche de création réelle/,
  );
  assert.doesNotMatch(registryService, /service_role/i);
  assert.doesNotMatch(dashboard, /access_token|personal_access_token/i);
  assert.doesNotMatch(costPlanList, /access_token|personal_access_token/i);
});

test("le worker transmet seulement le contenu public et chiffré du plan", async () => {
  const calls = [];
  const client = createPlatformRegistryClient({
    platformUrl: "https://platform.example.test",
    serviceRoleKey: "server-only-test-key",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return createMockResponse("stored-plan-id");
    },
  });

  await client.storeCostPlan(
    { job_id: "job-123" },
    {
      planId: "plan_1234567890abcdef12345678",
      adapterName: "supabase",
      step: "supabase_project",
      action: "create_project",
      idempotencyKey: "pelote-manager:job-123:supabase_project",
      createsBillableResource: true,
      estimatedCost: {
        currency: "EUR",
        oneTimeCents: 0,
        monthlyCents: 1_000,
      },
      publicSummary: "Créer un projet Supabase isolé.",
    },
  );

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /platform_worker_store_cost_plan$/);

  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body, {
    target_job_id: "job-123",
    new_plan_id: "plan_1234567890abcdef12345678",
    new_provider: "supabase",
    new_step: "supabase_project",
    new_action: "create_project",
    new_idempotency_key: "pelote-manager:job-123:supabase_project",
    new_creates_billable_resource: true,
    new_currency: "EUR",
    new_one_time_cents: 0,
    new_monthly_cents: 1_000,
    new_public_summary: "Créer un projet Supabase isolé.",
  });
  assert.doesNotMatch(JSON.stringify(body), /token|password|secret/i);
});
