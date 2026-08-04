import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { processProvisioningJob } from "../workers/platform-provisioner/processProvisioningJob.mjs";
import {
  PROVISIONER_SIMULATION_ACK,
  createProvisioningProvider,
  resolveProvisionerMode,
} from "../workers/platform-provisioner/providerFactory.mjs";

const simulationSources = [
  "workers/platform-provisioner/providerFactory.mjs",
  "workers/platform-provisioner/providers/simulation/simulationProvisioningProvider.mjs",
  "workers/platform-provisioner/providers/simulation/supabaseSimulationAdapter.mjs",
  "workers/platform-provisioner/providers/simulation/vercelSimulationAdapter.mjs",
].map((path) => fs.readFileSync(path, "utf8"));

function createSimulationJob() {
  return {
    job_id: "job-simulation-123",
    club_id: "club-simulation-123",
    status: "running",
    current_step: "requested",
    attempt_count: 1,
    lease_token: "lease-1",
    club_name: "Club Simulation",
    club_slug: "simulation-club",
    contact_email: "simulation@example.test",
    subscription_plan: "standard",
    supabase_project_ref: null,
    supabase_url: null,
    vercel_project_name: null,
    deployment_url: null,
    current_version: null,
  };
}

function createMutableRegistry(job) {
  const calls = [];
  const referenceMapping = {
    supabaseProjectRef: "supabase_project_ref",
    supabaseUrl: "supabase_url",
    vercelProjectName: "vercel_project_name",
    deploymentUrl: "deployment_url",
    currentVersion: "current_version",
  };

  return {
    calls,

    async heartbeat(targetJob, step) {
      calls.push({ type: "heartbeat", targetJob, step });
    },

    async updateJob(targetJob, update) {
      calls.push({ type: "update", targetJob, update });
      job.status = update.status;
      job.current_step = update.currentStep;

      for (const [key, value] of Object.entries(update.references || {})) {
        if (value) job[referenceMapping[key]] = value;
      }
    },
  };
}

function createSimulationEnv(overrides = {}) {
  return {
    PLATFORM_PROVISIONER_MODE: "simulation",
    PLATFORM_PROVISIONER_SIMULATION_ACK: PROVISIONER_SIMULATION_ACK,
    PLATFORM_PROVISIONER_SIMULATION_SLUG_PREFIX: "simulation-",
    PLATFORM_PROVISIONER_APPLICATION_VERSION: "43.0.0-simulation",
    ...overrides,
  };
}

test("le worker reste manuel par défaut", async () => {
  assert.equal(resolveProvisionerMode({}), "manual");

  const provider = createProvisioningProvider({ env: {} });
  assert.equal(provider.mode, "manual");

  const result = await provider.executeStep({ step: "supabase_project" });
  assert.equal(result.status, "waiting_external");
});

test("la simulation exige une confirmation explicite", () => {
  assert.throws(
    () =>
      createProvisioningProvider({
        env: { PLATFORM_PROVISIONER_MODE: "simulation" },
      }),
    /confirmation explicite/,
  );
});

test("le mode réel reste impossible dans la PR43", () => {
  assert.throws(
    () =>
      createProvisioningProvider({
        env: { PLATFORM_PROVISIONER_MODE: "live" },
      }),
    /mode réel Supabase\/Vercel n’est pas disponible/,
  );
});

test("la simulation complète le parcours avec des références réservées et déterministes", async () => {
  const job = createSimulationJob();
  const registry = createMutableRegistry(job);
  const provider = createProvisioningProvider({ env: createSimulationEnv() });

  for (let attempt = 1; attempt <= 12 && job.current_step !== "completed"; attempt += 1) {
    job.lease_token = `lease-${attempt}`;
    await processProvisioningJob({ job, registry, provider });
  }

  assert.equal(job.status, "completed");
  assert.equal(job.current_step, "completed");
  assert.match(job.supabase_project_ref, /^sim[a-f0-9]{17}$/);
  assert.equal(
    job.supabase_url,
    `https://${job.supabase_project_ref}.supabase.invalid`,
  );
  assert.equal(job.vercel_project_name, "sim-simulation-club");
  assert.equal(
    job.deployment_url,
    "https://sim-simulation-club.pelote-manager.invalid",
  );
  assert.equal(job.current_version, "43.0.0-simulation");

  const firstProjectRef = job.supabase_project_ref;
  const repeatedProvider = createProvisioningProvider({
    env: createSimulationEnv(),
  });
  const repeatedResult = await repeatedProvider.executeStep({
    jobId: job.job_id,
    clubSlug: job.club_slug,
    step: "supabase_project",
    idempotencyKey: `pelote-manager:${job.job_id}:supabase_project`,
    existingReferences: {},
  });

  assert.equal(
    repeatedResult.references.supabaseProjectRef,
    firstProjectRef,
  );
});

test("la simulation refuse un vrai identifiant de club", async () => {
  const provider = createProvisioningProvider({ env: createSimulationEnv() });

  await assert.rejects(
    () =>
      provider.executeStep({
        clubSlug: "pelotaris-club-lourdais",
        step: "supabase_project",
        idempotencyKey: "pelote-manager:job:step",
      }),
    /réservée aux clubs dont l’identifiant commence par simulation-/,
  );
});

test("les adaptateurs de simulation ne contiennent aucun appel fournisseur ni secret", () => {
  const source = simulationSources.join("\n");

  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /api\.supabase\.com/);
  assert.doesNotMatch(source, /api\.vercel\.com/);
  assert.doesNotMatch(source, /SUPABASE_ACCESS_TOKEN/);
  assert.doesNotMatch(source, /VERCEL_TOKEN/);
  assert.match(source, /\.supabase\.invalid/);
  assert.match(source, /\.pelote-manager\.invalid/);
});
