import { pathToFileURL } from "node:url";
import { createPlatformRegistryClient } from "./platformRegistryClient.mjs";
import { processProvisioningJob } from "./processProvisioningJob.mjs";
import { createProvisioningProvider } from "./providerFactory.mjs";
import { sanitizeErrorMessage } from "./provisioningStateMachine.mjs";

export async function runOnce({ env = process.env, fetchImpl = fetch } = {}) {
  const workerId =
    env.PLATFORM_PROVISIONER_WORKER_ID || `worker-${process.pid}`;
  const leaseDurationSeconds = Number(
    env.PLATFORM_PROVISIONER_LEASE_SECONDS || 300,
  );

  const registry = createPlatformRegistryClient({
    platformUrl: env.PLATFORM_SUPABASE_URL,
    serviceRoleKey: env.PLATFORM_SUPABASE_SERVICE_ROLE_KEY,
    fetchImpl,
  });
  const provider = createProvisioningProvider({ env });
  const job = await registry.claimNextJob(workerId, leaseDurationSeconds);

  if (!job) {
    console.info("Aucun provisionnement en attente.", {
      providerMode: provider.mode,
    });
    return null;
  }

  console.info("Provisionnement pris en charge.", {
    jobId: job.job_id,
    clubSlug: job.club_slug,
    step: job.current_step,
    attemptCount: job.attempt_count,
    providerMode: provider.mode,
  });

  return processProvisioningJob({
    job,
    registry,
    provider,
    logger: console,
  });
}

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  runOnce().catch((error) => {
    console.error("Le worker de provisionnement s’est arrêté.", {
      message: sanitizeErrorMessage(error),
    });
    process.exitCode = 1;
  });
}
