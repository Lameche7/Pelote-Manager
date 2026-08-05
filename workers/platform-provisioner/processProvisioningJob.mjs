import {
  assertProvisioningStep,
  createIdempotencyKey,
  nextProvisioningStep,
  sanitizeErrorMessage,
  sanitizeProviderReferences,
} from "./provisioningStateMachine.mjs";

const silentLogger = Object.freeze({
  info() {},
  error() {},
});

export async function processProvisioningJob({
  job,
  registry,
  provider,
  logger = silentLogger,
}) {
  if (!job?.job_id || !job?.lease_token) {
    throw new Error("Le provisionnement revendiqué est incomplet.");
  }

  assertProvisioningStep(job.current_step);
  await registry.heartbeat(job, job.current_step);

  if (job.current_step === "completed") {
    await registry.updateJob(job, {
      status: "completed",
      currentStep: "completed",
      references: {},
    });
    return { status: "completed", currentStep: "completed" };
  }

  if (job.current_step === "requested") {
    const currentStep = nextProvisioningStep(job.current_step);
    await registry.updateJob(job, {
      status: "pending",
      currentStep,
      references: {},
    });
    return { status: "pending", currentStep };
  }

  const context = {
    jobId: job.job_id,
    clubId: job.club_id,
    clubName: job.club_name,
    clubSlug: job.club_slug,
    contactEmail: job.contact_email,
    subscriptionPlan: job.subscription_plan,
    step: job.current_step,
    idempotencyKey: createIdempotencyKey(job.job_id, job.current_step),
    existingReferences: {
      supabaseProjectRef: job.supabase_project_ref,
      supabaseUrl: job.supabase_url,
      vercelProjectName: job.vercel_project_name,
      deploymentUrl: job.deployment_url,
      currentVersion: job.current_version,
    },
  };

  try {
    const result = await provider.executeStep(context);
    const references = sanitizeProviderReferences(result?.references);

    if (result?.status === "waiting_external") {
      logger.info(result.message || "Une action extérieure est requise.", {
        jobId: job.job_id,
        clubSlug: job.club_slug,
        step: job.current_step,
      });
      await registry.updateJob(job, {
        status: "waiting_external",
        currentStep: job.current_step,
        references,
      });
      return { status: "waiting_external", currentStep: job.current_step };
    }

    if (result?.status !== "completed") {
      throw new Error("Le fournisseur a renvoyé un résultat invalide.");
    }

    const currentStep = nextProvisioningStep(job.current_step);
    const status = currentStep === "completed" ? "completed" : "pending";

    await registry.updateJob(job, {
      status,
      currentStep,
      references,
    });

    return { status, currentStep };
  } catch (error) {
    const errorMessage = sanitizeErrorMessage(error);
    logger.error("Échec du provisionnement.", {
      jobId: job.job_id,
      clubSlug: job.club_slug,
      step: job.current_step,
      errorMessage,
    });

    await registry.updateJob(job, {
      status: "failed",
      currentStep: job.current_step,
      references: {},
      errorMessage,
    });

    return {
      status: "failed",
      currentStep: job.current_step,
      errorMessage,
    };
  }
}
