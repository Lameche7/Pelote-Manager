import { requirePlatformSupabase } from "@/infrastructure/platform/platformClient";

export type PlatformClubStatus =
  | "provisioning"
  | "trial"
  | "active"
  | "suspended"
  | "cancelled";

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
