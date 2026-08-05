import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { authorizeLiveExecutionConfirmation } from "../workers/platform-provisioner/providers/live/liveExecutionConfirmationGuard.mjs";

const migration = fs.readFileSync(
  "supabase/platform/migrations/20260805020000_add_live_execution_confirmations.sql",
  "utf8",
);
const panel = fs.readFileSync(
  "src/features/platform/components/PlatformLiveExecutionConfirmationPanel.tsx",
  "utf8",
);
const service = fs.readFileSync(
  "src/features/platform/services/platformRegistryService.ts",
  "utf8",
);
const planner = fs.readFileSync(
  "workers/platform-provisioner/providers/live/liveProvisioningPlanner.mjs",
  "utf8",
);

const expected = {
  provisioningJobId: "job-1",
  clubId: "club-1",
  planSetKey: "live_1234567890abcdef12345678",
  currency: "EUR",
  oneTimeCents: 500,
  monthlyCents: 1_500,
  currentPlanCount: 2,
};

const confirmation = {
  confirmation_id: "confirmation-1",
  provisioning_job_id: "job-1",
  club_id: "club-1",
  plan_set_key: "live_1234567890abcdef12345678",
  currency: "EUR",
  one_time_cents: 500,
  monthly_cents: 1_500,
  current_plan_count: 2,
  confirmed_by: "admin-1",
  expires_at: "2026-08-05T10:10:00.000Z",
};

test("la confirmation renforcée correspond exactement au club, aux plans et au budget", () => {
  const authorization = authorizeLiveExecutionConfirmation({
    confirmation,
    expected,
    now: new Date("2026-08-05T10:00:00.000Z"),
  });

  assert.deepEqual(authorization, {
    authorized: true,
    confirmationId: "confirmation-1",
    confirmedBy: "admin-1",
    planSetKey: "live_1234567890abcdef12345678",
    expiresAt: "2026-08-05T10:10:00.000Z",
  });
});

test("un changement de plan, de coût ou une expiration bloque l’exécution", () => {
  assert.throws(
    () =>
      authorizeLiveExecutionConfirmation({
        confirmation: { ...confirmation, plan_set_key: "live_other" },
        expected,
        now: new Date("2026-08-05T10:00:00.000Z"),
      }),
    /jeu de plans confirmé/i,
  );

  assert.throws(
    () =>
      authorizeLiveExecutionConfirmation({
        confirmation: { ...confirmation, monthly_cents: 1_501 },
        expected,
        now: new Date("2026-08-05T10:00:00.000Z"),
      }),
    /coût mensuel confirmé/i,
  );

  assert.throws(
    () =>
      authorizeLiveExecutionConfirmation({
        confirmation,
        expected,
        now: new Date("2026-08-05T10:10:00.000Z"),
      }),
    /a expiré/i,
  );
});

test("la base exige les approbations, le slug, la phrase exacte et dix minutes", () => {
  assert.match(migration, /platform_live_execution_confirmations/);
  assert.match(migration, /public\.is_platform_admin\(\)/);
  assert.match(
    migration,
    /typed_club_slug\s+is distinct from\s+snapshot\.club_slug/,
  );
  assert.match(
    migration,
    /typed_confirmation\s+is distinct from\s+snapshot\.confirmation_phrase/,
  );
  assert.match(migration, /interval '10 minutes'/);
  assert.match(migration, /Tous les plans facturables doivent être approuvés/);
  assert.match(migration, /platform_worker_get_live_execution_confirmation/);
  assert.match(migration, /auth\.role\(\) <> 'service_role'/);
  assert.match(migration, /live_execution\.confirmed/);
  assert.match(migration, /live_execution\.revoked/);
});

test("le super admin retape le club et une phrase sans activer le mode réel", () => {
  assert.match(panel, /Slug du club/);
  assert.match(panel, /Phrase de confirmation/);
  assert.match(panel, /Mode réel désactivé/);
  assert.match(panel, /Confirmer pour.*minutes/s);
  assert.match(service, /platform_confirm_live_execution/);
  assert.match(service, /platform_revoke_live_execution_confirmation/);
  assert.match(planner, /authorizeExecution/);
  assert.match(planner, /LIVE_PROVISIONING_DISABLED_MESSAGE/);
  assert.doesNotMatch(
    panel,
    /service_role|access_token|personal_access_token|management_access_token/i,
  );
});
