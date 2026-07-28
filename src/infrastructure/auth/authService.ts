import type { User } from "@supabase/supabase-js";
import { supabase } from "@/infrastructure/supabase/client";
import { USER_ROLES, type UserRole } from "@/shared/config";
import type { AuthUser } from "@/shared/types/auth";

type AuthStateListener = (user: AuthUser | null) => void;

export interface AuthService {
  getCurrentUser(): Promise<AuthUser | null>;
  login(email: string, password: string): Promise<AuthUser>;
  logout(): Promise<void>;
  onAuthStateChange(listener: AuthStateListener): () => void;
}

function isUserRole(value: unknown): value is UserRole {
  return Object.values(USER_ROLES).some((role) => role === value);
}

/** Keeps Supabase-specific user data out of the React application. */
export function mapSupabaseUser(user: User): AuthUser {
  const metadata = user.user_metadata as Record<string, unknown>;
  const displayName = metadata.display_name;
  const role = metadata.role;

  return {
    id: user.id,
    email: user.email ?? "",
    ...(typeof displayName === "string" ? { displayName } : {}),
    role: isUserRole(role) ? role : USER_ROLES.visitor,
  };
}

export const authService: AuthService = {
  async getCurrentUser() {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      throw error;
    }

    return data.session ? mapSupabaseUser(data.session.user) : null;
  },

  async login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw error;
    }

    return mapSupabaseUser(data.user);
  },

  async logout() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      throw error;
    }
  },

  onAuthStateChange(listener) {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      listener(session ? mapSupabaseUser(session.user) : null);
    });

    return () => data.subscription.unsubscribe();
  },
};
