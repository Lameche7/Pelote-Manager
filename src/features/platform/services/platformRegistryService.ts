import { requirePlatformSupabase } from "@/infrastructure/platform/platformClient";

export type PlatformClubStatus =
  | "provisioning"
  | "trial"
  | "active"
  | "suspended"
  | "cancelled";

export type PlatformSubscriptionPlan = "standard" | "premium" | "custom";

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

export const platformRegistryService = {
  async listClubs(): Promise<PlatformClub[]> {
    const { data, error } = await requirePlatformSupabase().rpc(
      "platform_list_clubs",
    );

    if (error) throw error;
    return ((data ?? []) as PlatformClubRow[]).map(mapClub);
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
