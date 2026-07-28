import { supabase } from "@/infrastructure/supabase/client";
import { parseUserRole, type UserRole } from "@/shared/config";
import type { UserProfile } from "@/shared/types/profile";

type AdminProfileRow = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  role: unknown;
  created_at: string;
  updated_at: string;
};

function mapAdminProfile(row: AdminProfileRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name ?? undefined,
    lastName: row.last_name ?? undefined,
    displayName: row.display_name ?? undefined,
    role: parseUserRole(row.role),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class AdminUserServiceError extends Error {
  constructor(operation: string, message: string) {
    super(`Impossible de ${operation} les utilisateurs : ${message}`);
    this.name = "AdminUserServiceError";
  }
}

export const adminUserService = {
  async listProfiles(): Promise<UserProfile[]> {
    const { data, error } = await supabase.rpc("list_profiles_for_admin");

    if (error) {
      throw new AdminUserServiceError("charger", error.message);
    }

    return ((data ?? []) as AdminProfileRow[]).map(mapAdminProfile);
  },

  async setRole(profileId: string, role: UserRole): Promise<UserProfile> {
    const { data, error } = await supabase.rpc("set_profile_role", {
      target_profile_id: profileId,
      new_role: role,
    });

    if (error) {
      throw new AdminUserServiceError("modifier", error.message);
    }

    return mapAdminProfile(data as AdminProfileRow);
  },
};
