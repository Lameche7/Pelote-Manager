import type { UserProfile } from "@/shared/types/profile";
import type { Database } from "@/infrastructure/supabase/database";
import { parseUserRole } from "@/shared/config";

export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

export type ProfileInsert = Database["public"]["Tables"]["profiles"]["Insert"];

export function mapProfileRow(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    ...(row.first_name !== null ? { firstName: row.first_name } : {}),
    ...(row.last_name !== null ? { lastName: row.last_name } : {}),
    ...(row.display_name !== null ? { displayName: row.display_name } : {}),
    role: parseUserRole(row.role),
    ...(row.member_id !== null ? { memberId: row.member_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapProfileInsert(input: CreateProfileInput): ProfileInsert {
  return {
    id: input.id,
    email: input.email,
    ...(input.displayName ? { display_name: input.displayName } : {}),
  };
}

export type CreateProfileInput = {
  id: string;
  email: string;
  displayName?: string;
};
