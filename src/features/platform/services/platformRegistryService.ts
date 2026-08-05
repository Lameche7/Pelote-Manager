import { requirePlatformSupabase } from "@/infrastructure/platform/platformClient";

export type PlatformClubStatus =
  "provisioning" | "trial" | "active" | "suspended" | "cancelled";

export type PlatformSubscriptionPlan = "standard" | "premium" | "custom";

export type PlatformProvisioningStatus =
  | "pending"
  | "running"
  | "waiting_external"
  | "completed"
  | "failed"
  | "cancelled";

export type PlatformProvisioningStep =
  | "requested"
  | "supabase_project"
  | "database_migrations"
  | "club_bootstrap"
  | "first_admin"
  | "vercel_project"
  | "environment_variables"
  | "deployment"
  | "verification"
  | "completed";

export type PlatformCostPlanStatus =
  "pending" | "approved" | "expired" | "revoked" | "superseded";

export type PlatformCostPlanProvider = "supabase" | "vercel";

export type PlatformLiveExecutionConfirmationStatus =
  "confirmed" | "expired" | "revoked" | "consumed";

export type PlatformClub = {
  id: string;
  name: string;
  slug: string;
  contactEmail: string;
  subscriptionPlan: PlatformSubscriptionPlan;
  status: PlatformClubStatus;
  supabaseProjectRef: string;
  supabaseUrl: string;
  vercelProjectName: string;
  deploymentUrl: string;
  currentVersion: string;
  targetVersion: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type PlatformProvisioningJob = {
  id: string;
  clubId: string;
  status: PlatformProvisioningStatus;
  currentStep: PlatformProvisioningStep;
  requestedAt: string;
  startedAt: string;
  completedAt: string;
  lastErrorMessage: string;
  updatedAt: string;
};

export type PlatformCostPlan = {
  id: string;
  planId: string;
  provisioningJobId: string;
  clubId: string;
  provider: PlatformCostPlanProvider;
  step: Exclude<PlatformProvisioningStep, "requested" | "completed">;
  action: string;
  createsBillableResource: boolean;
  currency: string;
  oneTimeCents: number;
  monthlyCents: number;
  publicSummary: string;
  status: PlatformCostPlanStatus;
  approvedAt: string;
  approvalExpiresAt: string;
  createdAt: string;
};

export type PlatformLiveExecutionPreview = {
  provisioningJobId: string;
  clubId: string;
  clubSlug: string;
  planSetKey: string;
  currency: string;
  oneTimeCents: number;
  monthlyCents: number;
  currentPlanCount: number;
  confirmationPhrase: string;
  validityMinutes: number;
};

export type PlatformLiveExecutionConfirmation = {
  id: string;
  provisioningJobId: string;
  clubId: string;
  planSetKey: string;
  currency: string;
  oneTimeCents: number;
  monthlyCents: number;
  currentPlanCount: number;
  status: PlatformLiveExecutionConfirmationStatus;
  confirmedAt: string;
  expiresAt: string;
};

export type CreatePlatformClubInput = {
  name: string;
  slug: string;
  contactEmail: string;
  subscriptionPlan: PlatformSubscriptionPlan;
  notes: string;
};

type PlatformClubRow = {
  id: string;
  name: string;
  slug: string;
  contact_email: string | null;
  subscription_plan: PlatformSubscriptionPlan;
  status: PlatformClubStatus;
  supabase_project_ref: string | null;
  supabase_url: string | null;
  vercel_project_name: string | null;
  deployment_url: string | null;
  current_version: string | null;
  target_version: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type PlatformProvisioningJobRow = {
  id: string;
  club_id: string;
  status: PlatformProvisioningStatus;
  current_step: PlatformProvisioningStep;
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
  last_error_message: string | null;
  updated_at: string;
};

type PlatformCostPlanRow = {
  id: string;
  plan_id: string;
  provisioning_job_id: string;
  club_id: string;
  provider: PlatformCostPlanProvider;
  step: PlatformCostPlan["step"];
  action: string;
  creates_billable_resource: boolean;
  currency: string;
  one_time_cents: number;
  monthly_cents: number;
  public_summary: string;
  lifecycle_status: PlatformCostPlanStatus;
  approved_at: string | null;
  approval_expires_at: string | null;
  created_at: string;
};

type PlatformLiveExecutionPreviewRow = {
  provisioning_job_id: string;
  club_id: string;
  club_slug: string;
  plan_set_key: string;
  currency: string;
  one_time_cents: number;
  monthly_cents: number;
  current_plan_count: number;
  confirmation_phrase: string;
  validity_minutes: number;
};

type PlatformLiveExecutionConfirmationRow = {
  id: string;
  provisioning_job_id: string;
  club_id: string;
  plan_set_key: string;
  currency: string;
  one_time_cents: number;
  monthly_cents: number;
  current_plan_count: number;
  lifecycle_status: PlatformLiveExecutionConfirmationStatus;
  confirmed_at: string;
  expires_at: string;
};

const mapClub = (row: PlatformClubRow): PlatformClub => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  contactEmail: row.contact_email ?? "",
  subscriptionPlan: row.subscription_plan,
  status: row.status,
  supabaseProjectRef: row.supabase_project_ref ?? "",
  supabaseUrl: row.supabase_url ?? "",
  vercelProjectName: row.vercel_project_name ?? "",
  deploymentUrl: row.deployment_url ?? "",
  currentVersion: row.current_version ?? "",
  targetVersion: row.target_version ?? "",
  notes: row.notes ?? "",
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapProvisioningJob = (
  row: PlatformProvisioningJobRow,
): PlatformProvisioningJob => ({
  id: row.id,
  clubId: row.club_id,
  status: row.status,
  currentStep: row.current_step,
  requestedAt: row.requested_at,
  startedAt: row.started_at ?? "",
  completedAt: row.completed_at ?? "",
  lastErrorMessage: row.last_error_message ?? "",
  updatedAt: row.updated_at,
});

const mapCostPlan = (row: PlatformCostPlanRow): PlatformCostPlan => ({
  id: row.id,
  planId: row.plan_id,
  provisioningJobId: row.provisioning_job_id,
  clubId: row.club_id,
  provider: row.provider,
  step: row.step,
  action: row.action,
  createsBillableResource: row.creates_billable_resource,
  currency: row.currency,
  oneTimeCents: Number(row.one_time_cents),
  monthlyCents: Number(row.monthly_cents),
  publicSummary: row.public_summary,
  status: row.lifecycle_status,
  approvedAt: row.approved_at ?? "",
  approvalExpiresAt: row.approval_expires_at ?? "",
  createdAt: row.created_at,
});

const mapLiveExecutionPreview = (
  row: PlatformLiveExecutionPreviewRow,
): PlatformLiveExecutionPreview => ({
  provisioningJobId: row.provisioning_job_id,
  clubId: row.club_id,
  clubSlug: row.club_slug,
  planSetKey: row.plan_set_key,
  currency: row.currency,
  oneTimeCents: Number(row.one_time_cents),
  monthlyCents: Number(row.monthly_cents),
  currentPlanCount: Number(row.current_plan_count),
  confirmationPhrase: row.confirmation_phrase,
  validityMinutes: Number(row.validity_minutes),
});

const mapLiveExecutionConfirmation = (
  row: PlatformLiveExecutionConfirmationRow,
): PlatformLiveExecutionConfirmation => ({
  id: row.id,
  provisioningJobId: row.provisioning_job_id,
  clubId: row.club_id,
  planSetKey: row.plan_set_key,
  currency: row.currency,
  oneTimeCents: Number(row.one_time_cents),
  monthlyCents: Number(row.monthly_cents),
  currentPlanCount: Number(row.current_plan_count),
  status: row.lifecycle_status,
  confirmedAt: row.confirmed_at,
  expiresAt: row.expires_at,
});

export const platformRegistryService = {
  async listClubs(): Promise<PlatformClub[]> {
    const { data, error } = await requirePlatformSupabase().rpc(
      "platform_list_clubs",
    );

    if (error) throw error;
    return ((data ?? []) as PlatformClubRow[]).map(mapClub);
  },

  async listProvisioningJobs(): Promise<PlatformProvisioningJob[]> {
    const { data, error } = await requirePlatformSupabase().rpc(
      "platform_list_provisioning_jobs",
    );

    if (error) throw error;
    return ((data ?? []) as PlatformProvisioningJobRow[]).map(
      mapProvisioningJob,
    );
  },

  async listCostPlans(): Promise<PlatformCostPlan[]> {
    const { data, error } = await requirePlatformSupabase().rpc(
      "platform_list_cost_plans",
    );

    if (error) throw error;
    return ((data ?? []) as PlatformCostPlanRow[]).map(mapCostPlan);
  },

  async listLiveExecutionConfirmations(): Promise<
    PlatformLiveExecutionConfirmation[]
  > {
    const { data, error } = await requirePlatformSupabase().rpc(
      "platform_list_live_execution_confirmations",
    );

    if (error) throw error;
    return ((data ?? []) as PlatformLiveExecutionConfirmationRow[]).map(
      mapLiveExecutionConfirmation,
    );
  },

  async previewLiveExecutionConfirmation(
    provisioningJobId: string,
  ): Promise<PlatformLiveExecutionPreview> {
    const { data, error } = await requirePlatformSupabase().rpc(
      "platform_preview_live_execution_confirmation",
      {
        target_job_id: provisioningJobId,
      },
    );

    if (error) throw error;
    const row = (data as PlatformLiveExecutionPreviewRow[] | null)?.[0];
    if (!row) throw new Error("Prévisualisation renforcée indisponible.");
    return mapLiveExecutionPreview(row);
  },

  async confirmLiveExecution(input: {
    provisioningJobId: string;
    planSetKey: string;
    clubSlug: string;
    confirmationPhrase: string;
  }): Promise<string> {
    const { data, error } = await requirePlatformSupabase().rpc(
      "platform_confirm_live_execution",
      {
        target_job_id: input.provisioningJobId,
        expected_plan_set_key: input.planSetKey,
        typed_club_slug: input.clubSlug,
        typed_confirmation: input.confirmationPhrase,
      },
    );

    if (error) throw error;
    return String(data);
  },

  async revokeLiveExecutionConfirmation(confirmationId: string): Promise<void> {
    const { error } = await requirePlatformSupabase().rpc(
      "platform_revoke_live_execution_confirmation",
      {
        target_confirmation_id: confirmationId,
        new_reason: "Révocation depuis la plateforme propriétaire",
      },
    );

    if (error) throw error;
  },

  async createClub(input: CreatePlatformClubInput): Promise<string> {
    const { data, error } = await requirePlatformSupabase().rpc(
      "platform_create_club",
      {
        new_name: input.name,
        new_slug: input.slug,
        new_contact_email: input.contactEmail || null,
        new_subscription_plan: input.subscriptionPlan,
        new_notes: input.notes || null,
      },
    );

    if (error) throw error;
    return String(data);
  },

  async requestProvisioning(clubId: string): Promise<string> {
    const { data, error } = await requirePlatformSupabase().rpc(
      "platform_request_provisioning",
      {
        target_club_id: clubId,
      },
    );

    if (error) throw error;
    return String(data);
  },

  async approveCostPlan(costPlanId: string): Promise<string> {
    const { data, error } = await requirePlatformSupabase().rpc(
      "platform_approve_cost_plan",
      {
        target_cost_plan_id: costPlanId,
      },
    );

    if (error) throw error;
    return String(data);
  },

  async revokeCostPlanApproval(costPlanId: string): Promise<void> {
    const { error } = await requirePlatformSupabase().rpc(
      "platform_revoke_cost_plan_approval",
      {
        target_cost_plan_id: costPlanId,
        new_reason: "Révocation depuis la plateforme propriétaire",
      },
    );

    if (error) throw error;
  },

  async updateStatus(
    clubId: string,
    status: PlatformClubStatus,
  ): Promise<void> {
    const { error } = await requirePlatformSupabase().rpc(
      "platform_update_club_status",
      {
        target_club_id: clubId,
        new_status: status,
      },
    );

    if (error) throw error;
  },
};
