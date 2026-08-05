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

function readSingleAccess(data: unknown): ClubAccess | null {
  const memberships = (data ?? []) as AccessRow[];

  if (memberships.length === 0) {
    return null;
  }

  if (memberships.length > 1) {
    throw new Error(
      "Plusieurs clubs sont associés à votre compte. Le sélecteur multi-club n’est pas encore disponible.",
    );
  }

  const membership = memberships[0];
  return {
    clubId: membership.club_id,
    clubName: membership.club_name,
    permissions: membership.permission_keys,
  };
}

export const adminAccessService = {
  async getOptionalAccess(): Promise<ClubAccess | null> {
    const { data, error } = await supabase.rpc("get_my_club_access");
    if (error) throw error;

    return readSingleAccess(data);
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
