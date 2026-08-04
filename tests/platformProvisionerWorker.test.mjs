import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createManualProvisioningProvider } from "../workers/platform-provisioner/manualProvisioningProvider.mjs";
import { processProvisioningJob } from "../workers/platform-provisioner/processProvisioningJob.mjs";
import {
  PROVISIONING_STEPS,
  createIdempotencyKey,
  nextProvisioningStep,
  sanitizeErrorMessage,
  sanitizeProviderReferences,
} from "../workers/platform-provisioner/provisioningStateMachine.mjs";

const migration = fs.readFileSync(
  "supabase/platform/migrations/20260804030000_add_provisioning_worker_leases.sql",
  "utf8",
);
const registryClient = fs.readFileSync(
  "workers/platform-provisioner/platformRegistryClient.mjs",
  "utf8",
);
const runOnce = fs.readFileSync(
  "workers/platform-provisioner/runOnce.mjs",
  "utf8",
);
const workerReadme = fs.readFileSync(
  "workers/platform-provisioner/README.md",
  "utf8",
);

const createJob = (currentStep = "requested") => ({
  job_id: "job-123",
  club_id: "club-123",
  status: "running",
  current_step: currentStep,
  attempt_count: 1,
  lease_token: "lease-123",
  club_name: "Club de test",
  club_slug: "club-de-test",
  contact_email: "contact@example.test",
  subscription_plan: "standard",
  supabase_project_ref: null,
  supabase_url: null,
  vercel_project_name: null,
  deployment_url: null,
  current_version: null,
});

function createRegistryRecorder() {
  const calls = [];
  return {
    calls,
    async heartbeat(job, step) {
      calls.push({ type: "heartbeat", job, step });
    },
    async updateJob(job, update) {
      calls.push({ type: "update", job, update });
    },
  };
}

test("la machine d’états avance dans un ordre stable et idempotent", () => {
  assert.equal(PROVISIONING_STEPS[0], "requested");
  assert.equal(PROVISIONING_STEPS.at(-1), "completed");
  assert.equal(nextProvisioningStep("requested"), "supabase_project");
  assert.equal(nextProvisioningStep("verification"), "completed");
  assert.equal(nextProvisioningStep("completed"), "completed");
  assert.equal(
    createIdempotencyKey("job-123", "deployment"),
    "pelote-manager:job-123:deployment",
  );
});

test("les erreurs et références techniques ne peuvent pas transporter de secret", () => {
  assert.equal(
    sanitizeErrorMessage(
      "token=abc123 password:bonjour Bearer eyJhbGciOiJIUzI1NiJ9.payload",
    ),
    "token=[REDACTED] password=[REDACTED] Bearer [REDACTED]",
  );
  assert.deepEqual(
    sanitizeProviderReferences({
      supabaseProjectRef: " project-ref ",
      deploymentUrl: "https://club.example.test",
    }),
    {
      supabaseProjectRef: "project-ref",
      deploymentUrl: "https://club.example.test",
    },
  );
  assert.throws(
    () => sanitizeProviderReferences({ serviceRoleKey: "interdit" }),
    /Référence technique interdite/,
  );
});

test("la première prise en charge prépare l’étape Supabase puis libère le bail", async () => {
  const registry = createRegistryRecorder();
  const result = await processProvisioningJob({
    job: createJob(),
    registry,
    provider: createManualProvisioningProvider(),
  });

  assert.deepEqual(result, {
    status: "pending",
    currentStep: "supabase_project",
  });
  assert.equal(registry.calls[0].type, "heartbeat");
  assert.deepEqual(registry.calls[1].update, {
    status: "pending",
    currentStep: "supabase_project",
    references: {},
  });
});

test("le fournisseur manuel attend une action extérieure sans créer de ressource", async () => {
  const registry = createRegistryRecorder();
  const result = await processProvisioningJob({
    job: createJob("supabase_project"),
    registry,
    provider: createManualProvisioningProvider(),
  });

  assert.deepEqual(result, {
    status: "waiting_external",
    currentStep: "supabase_project",
  });
  assert.deepEqual(registry.calls[1].update, {
    status: "waiting_external",
    currentStep: "supabase_project",
    references: {},
  });
});

test("une vérification réussie termine l’instance avec seulement des références publiques", async () => {
  const registry = createRegistryRecorder();
  const result = await processProvisioningJob({
    job: createJob("verification"),
    registry,
    provider: {
      async executeStep(context) {
        assert.equal(
          context.idempotencyKey,
          "pelote-manager:job-123:verification",
        );
        return {
          status: "completed",
          references: {
            currentVersion: "1.0.0",
            deploymentUrl: "https://club.example.test",
          },
        };
      },
    },
  });

  assert.deepEqual(result, {
    status: "completed",
    currentStep: "completed",
  });
  assert.deepEqual(registry.calls[1].update, {
    status: "completed",
    currentStep: "completed",
    references: {
      currentVersion: "1.0.0",
      deploymentUrl: "https://club.example.test",
    },
  });
});

test("une réponse fournisseur invalide échoue sans enregistrer son secret", async () => {
  const registry = createRegistryRecorder();
  const result = await processProvisioningJob({
    job: createJob("vercel_project"),
    registry,
    provider: {
      async executeStep() {
        return {
          status: "completed",
          references: { token: "secret-provider-token" },
        };
      },
    },
  });

  assert.equal(result.status, "failed");
  assert.match(result.errorMessage, /Référence technique interdite/);
  assert.doesNotMatch(result.errorMessage, /secret-provider-token/);
  assert.equal(registry.calls[1].update.status, "failed");
});

test("la base centrale revendique les tâches avec un bail exclusif reprenable", () => {
  assert.match(migration, /attempt_count integer not null default 0/);
  assert.match(migration, /lease_token uuid null/);
  assert.match(migration, /lease_expires_at timestamptz null/);
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /jobs\.lease_expires_at < now\(\)/);
  assert.match(migration, /gen_random_uuid\(\)/);
  assert.match(migration, /attempt_count = jobs\.attempt_count \+ 1/);
  assert.match(
    migration,
    /Le bail du provisionnement est absent, expiré ou remplacé/,
  );
});

test("seul le service serveur peut revendiquer, prolonger ou terminer un travail", () => {
  for (const functionName of [
    "platform_worker_claim_next_provisioning",
    "platform_worker_heartbeat_provisioning",
    "platform_worker_update_provisioning",
  ]) {
    const start = migration.indexOf(`function public.${functionName}`);
    assert.notEqual(start, -1, `${functionName} doit exister`);
    const end = migration.indexOf("$$;", start);
    assert.match(
      migration.slice(start, end + 3),
      /auth\.role\(\) <> 'service_role'/,
    );
  }

  assert.match(migration, /to service_role/g);
  assert.doesNotMatch(migration, /to authenticated;\s*$/m);
});

test("le worker utilise des variables serveur et n’est pas intégré au navigateur", () => {
  assert.match(registryClient, /PLATFORM_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(runOnce, /PLATFORM_PROVISIONER_WORKER_ID/);
  assert.doesNotMatch(registryClient, /VITE_/);
  assert.doesNotMatch(runOnce, /VITE_/);
  assert.match(
    workerReadme,
    /ne doit jamais être compilé dans l’application Vite/,
  );
  assert.match(
    workerReadme,
    /Aucune de ces variables ne doit commencer par `VITE_`/,
  );
});
