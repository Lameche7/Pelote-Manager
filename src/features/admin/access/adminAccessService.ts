import { supabase } from "@/infrastructure/supabase/client";
import type { AdminPermission } from "@/features/admin/config/adminPermissions";

export type ClubAccess = {
  clubId: string;
  clubName: string;
  permissions: AdminPermission[];
};

type AccessRow = {
  club_id: string;
  club_name: string;
  permission_keys: AdminPermission[];
};

function readAccesses(data: unknown): ClubAccess[] {
  const memberships = (data ?? []) as AccessRow[];
  return memberships.map((membership) => ({
    clubId: membership.club_id,
    clubName: membership.club_name,
    permissions: membership.permission_keys,
  }));
}

export const adminAccessService = {
  async listAuthorizedClubs(): Promise<ClubAccess[]> {
    const { data, error } = await supabase.rpc("get_my_club_access");
    if (error) throw error;
    return readAccesses(data);
  },

  async getOptionalAccess(): Promise<ClubAccess | null> {
    const accesses = await this.listAuthorizedClubs();
    if (accesses.length > 1) {
      throw new Error(
        "Sélection du club requise : aucun accès n'est choisi implicitement.",
      );
    }
    return accesses[0] ?? null;
  },

  async getAccess(): Promise<ClubAccess> {
    const access = await this.getOptionalAccess();
    if (!access) {
      throw new Error(
        "Aucune habilitation d’administration n’est associée à votre compte.",
      );
    }
    return access;
  },
};
