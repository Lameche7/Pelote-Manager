import type { UserRole } from "@/shared/config";

export type AuthUser = {
  id: string;
  email: string;
  displayName?: string;
  role: UserRole;
};

export type AuthState = {
  user: AuthUser | null;
  isLoading: boolean;
};
