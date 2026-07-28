import type { UserProfile } from "@/shared/types/profile";

export type ProfileRow = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  created_at: string;
  updated_at: string;
};

export type ProfileInsert = {
  id: string;
  email: string;
  display_name?: string;
};

export function mapProfileRow(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    ...(row.first_name !== null ? { firstName: row.first_name } : {}),
    ...(row.last_name !== null ? { lastName: row.last_name } : {}),
    ...(row.display_name !== null ? { displayName: row.display_name } : {}),
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
