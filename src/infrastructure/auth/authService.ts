import type { User } from "@supabase/supabase-js";
import { supabase } from "@/infrastructure/supabase/client";
import type { AuthUser } from "@/shared/types/auth";

type AuthStateListener = (user: AuthUser | null) => void;

export interface AuthService {
  getCurrentUser(): Promise<AuthUser | null>;
  login(email: string, password: string): Promise<AuthUser>;
  logout(): Promise<void>;
  onAuthStateChange(listener: AuthStateListener): () => void;
}

/** Keeps Supabase-specific user data out of the React application. */
export function mapSupabaseUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email ?? "",
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

export async function registerVisitor(input: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}): Promise<"completed" | "confirmation_required"> {
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        first_name: input.firstName.trim(),
        last_name: input.lastName.trim(),
      },
    },
  });
  if (error) throw error;
  if (!data.user) throw new Error("Le compte n’a pas pu être créé.");

  if (data.session) {
    const { error: profileError } = await supabase.from("profiles").upsert({
      id: data.user.id,
      email: input.email.trim().toLowerCase(),
      first_name: input.firstName.trim(),
      last_name: input.lastName.trim(),
      display_name: `${input.firstName.trim()} ${input.lastName.trim()}`,
    });
    if (profileError) throw profileError;
    await supabase.auth.signOut();
    return "completed";
  }
  return "confirmation_required";
}
