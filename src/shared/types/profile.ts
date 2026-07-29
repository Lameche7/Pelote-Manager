import type { UserRole } from "@/shared/config";

export type UserProfile = {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  role: UserRole;
  memberId?: string;
  createdAt: string;
  updatedAt: string;
};
