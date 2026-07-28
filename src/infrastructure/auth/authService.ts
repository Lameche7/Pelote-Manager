import { USER_ROLES } from "@/shared/config";
import type { AuthUser } from "@/shared/types/auth";

export interface AuthService {
  getCurrentUser(): Promise<AuthUser | null>;
  login(): Promise<AuthUser>;
  logout(): Promise<void>;
}

const DEMO_ADMIN: AuthUser = {
  id: "demo-admin",
  email: "admin@pelote-manager.local",
  displayName: "Administrateur",
  role: USER_ROLES.admin,
};

export function createInMemoryAuthService(): AuthService {
  let currentUser: AuthUser | null = null;

  return {
    async getCurrentUser() {
      return currentUser;
    },
    async login() {
      currentUser = DEMO_ADMIN;
      return currentUser;
    },
    async logout() {
      currentUser = null;
    },
  };
}

export const authService = createInMemoryAuthService();
