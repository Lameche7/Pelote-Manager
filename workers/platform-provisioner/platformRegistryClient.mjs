function normalizeBaseUrl(value) {
  const url = new URL(value);
  return url.toString().replace(/\/$/, "");
}

async function readJsonResponse(response) {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      payload?.message || payload?.error_description || payload?.hint || text;
    throw new Error(message || `Erreur HTTP ${response.status}`);
  }

  return payload;
}

export function createPlatformRegistryClient({
  platformUrl,
  serviceRoleKey,
  fetchImpl = fetch,
}) {
  if (!platformUrl) {
    throw new Error("PLATFORM_SUPABASE_URL est obligatoire.");
  }

  if (!serviceRoleKey) {
    throw new Error("PLATFORM_SUPABASE_SERVICE_ROLE_KEY est obligatoire.");
  }

  const baseUrl = normalizeBaseUrl(platformUrl);

  const callRpc = async (name, body) => {
    const response = await fetchImpl(`${baseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    return readJsonResponse(response);
  };

  return {
    async claimNextJob(workerId, leaseDurationSeconds = 300) {
      const rows = await callRpc("platform_worker_claim_next_provisioning", {
        new_worker_id: workerId,
        lease_duration_seconds: leaseDurationSeconds,
      });

      return Array.isArray(rows) ? (rows[0] ?? null) : null;
    },

    async claimNextSimulationJob(
      workerId,
      expectedSlugPrefix = "simulation-",
      leaseDurationSeconds = 300,
    ) {
      const rows = await callRpc(
        "platform_worker_claim_next_simulation_provisioning",
        {
          new_worker_id: workerId,
          expected_slug_prefix: expectedSlugPrefix,
          lease_duration_seconds: leaseDurationSeconds,
        },
      );

      return Array.isArray(rows) ? (rows[0] ?? null) : null;
    },

    async heartbeat(job, reportedCurrentStep, leaseDurationSeconds = 300) {
      await callRpc("platform_worker_heartbeat_provisioning", {
        target_job_id: job.job_id,
        expected_lease_token: job.lease_token,
        reported_current_step: reportedCurrentStep,
        lease_duration_seconds: leaseDurationSeconds,
      });
    },

    async storeCostPlan(job, plan) {
      return callRpc("platform_worker_store_cost_plan", {
        target_job_id: job.job_id,
        new_plan_id: plan.planId,
        new_provider: plan.adapterName,
        new_step: plan.step,
        new_action: plan.action,
        new_idempotency_key: plan.idempotencyKey,
        new_creates_billable_resource: plan.createsBillableResource,
        new_currency: plan.estimatedCost.currency,
        new_one_time_cents: plan.estimatedCost.oneTimeCents,
        new_monthly_cents: plan.estimatedCost.monthlyCents,
        new_public_summary: plan.publicSummary,
      });
    },

    async getLiveExecutionConfirmation(job, planSetKey) {
      const rows = await callRpc(
        "platform_worker_get_live_execution_confirmation",
        {
          target_job_id: job.job_id,
          expected_plan_set_key: planSetKey,
        },
      );

      return Array.isArray(rows) ? (rows[0] ?? null) : null;
    },

    async updateJob(job, update) {
      await callRpc("platform_worker_update_provisioning", {
        target_job_id: job.job_id,
        expected_lease_token: job.lease_token,
        new_status: update.status,
        new_current_step: update.currentStep,
        new_supabase_project_ref: update.references?.supabaseProjectRef ?? null,
        new_supabase_url: update.references?.supabaseUrl ?? null,
        new_vercel_project_name: update.references?.vercelProjectName ?? null,
        new_deployment_url: update.references?.deploymentUrl ?? null,
        new_current_version: update.references?.currentVersion ?? null,
        new_error_message: update.errorMessage ?? null,
      });
    },
  };
}
