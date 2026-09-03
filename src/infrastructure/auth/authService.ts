import type { User } from "@supabase/supabase-js";
import { supabase } from "@/infrastructure/supabase/client";
import type { AuthUser } from "@/shared/types/auth";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

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
      throw new Error(
        getSupabaseErrorMessage(error, "Impossible de charger votre session."),
      );
    }

    return data.session ? mapSupabaseUser(data.session.user) : null;
  },

  async login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Connexion impossible. Merci de réessayer.",
        ),
      );
    }

    return mapSupabaseUser(data.user);
  },

  async logout() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Déconnexion impossible. Merci de réessayer.",
        ),
      );
    }
  },

  onAuthStateChange(listener) {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      listener(session ? mapSupabaseUser(session.user) : null);
    });

    return () => data.subscription.unsubscribe();
  },
};

const pendingExternalIdentityId = (user: User): string | null => {
  const value = user.user_metadata?.pending_external_identity_id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const clearPendingExternalIdentity = async () => {
  const { error } = await supabase.auth.updateUser({
    data: { pending_external_identity_id: null },
  });

  // Le rattachement est idempotent. Si la mise à jour des métadonnées échoue,
  // une reconnexion pourra simplement retenter la même confirmation.
  if (error) return;
};

export async function finalizePendingExternalParticipation(): Promise<boolean> {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    throw new Error(
      getSupabaseErrorMessage(
        error,
        "Impossible de finaliser votre participation au tournoi.",
      ),
    );
  }

  if (!data.user) return false;
  const externalIdentityId = pendingExternalIdentityId(data.user);
  if (!externalIdentityId) return false;

  const { error: claimError } = await supabase.rpc(
    "claim_external_participation",
    { target_external_identity_id: externalIdentityId },
  );

  if (claimError) {
    const businessErrors = new Set([
      "External participation not found",
      "External participation is no longer available",
      "External participation identity does not match profile",
      "External participation is not claimable",
      "Account already represents another player in this tournament",
    ]);

    if (businessErrors.has(String(claimError.message ?? ""))) {
      await clearPendingExternalIdentity();
      return false;
    }

    throw new Error(
      getSupabaseErrorMessage(
        claimError,
        "Impossible de finaliser votre participation au tournoi.",
      ),
    );
  }

  await clearPendingExternalIdentity();
  return true;
}

export async function registerAccount(input: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  externalIdentityId?: string | null;
}): Promise<"completed" | "confirmation_required"> {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const email = input.email.trim().toLowerCase();
  const externalIdentityId = input.externalIdentityId?.trim() || null;

  const { data, error } = await supabase.auth.signUp({
    email,
    password: input.password,
    options: {
      data: {
        first_name: firstName,
        last_name: lastName,
        ...(externalIdentityId
          ? { pending_external_identity_id: externalIdentityId }
          : {}),
      },
    },
  });
  if (error) throw new Error(getSupabaseErrorMessage(error));
  if (!data.user) throw new Error("Le compte n’a pas pu être créé.");

  if (data.session) {
    const { error: profileError } = await supabase.from("profiles").upsert({
      id: data.user.id,
      email,
      first_name: firstName,
      last_name: lastName,
      display_name: `${firstName} ${lastName}`,
    });
    if (profileError) {
      throw new Error(
        getSupabaseErrorMessage(
          profileError,
          "Le profil n’a pas pu être enregistré.",
        ),
      );
    }

    if (externalIdentityId) {
      await finalizePendingExternalParticipation();
    }

    await supabase.auth.signOut();
    return "completed";
  }

  return "confirmation_required";
}
