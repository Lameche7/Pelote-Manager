import { supabase } from "@/infrastructure/supabase/client";
import { profileService } from "@/infrastructure/profile/profileService";
import {
  completeMemberRegistrationWithCleanup,
  getRegistrationOutcome,
  mapRegistrationError,
  MemberRegistrationError,
  type RegistrationOutcome,
  VerificationAttemptLimiter,
} from "@/features/members/domain/memberRegistration";
import { mapSupabaseUser } from "@/infrastructure/auth/authService";
export { MemberRegistrationError } from "@/features/members/domain/memberRegistration";

export type MemberIdentity = {
  licenceNumber: string;
  lastName: string;
  firstName: string;
  birthDate: string;
};

export class MemberServiceError extends Error {
  readonly code: string | undefined;

  constructor(operation: string, message: string, code?: string) {
    super(`Impossible de ${operation} le licencié : ${message}`);
    this.name = "MemberServiceError";
    this.code = code;
  }
}

export type MemberRegistration = {
  identity: MemberIdentity;
  email: string;
  password: string;
};

function toRpcIdentity(identity: MemberIdentity) {
  return {
    licence_number: identity.licenceNumber,
    last_name: identity.lastName,
    first_name: identity.firstName,
    birth_date: identity.birthDate,
  };
}

function hasCompleteIdentity(identity: MemberIdentity): boolean {
  return (
    identity.licenceNumber.length > 0 &&
    identity.lastName.length > 0 &&
    identity.firstName.length > 0 &&
    identity.birthDate.length > 0
  );
}

const PENDING_IDENTITY_KEY = "pending_member_identity";
const VERIFICATION_LIMIT_KEY = "member_verification_attempts";

function createVerificationLimiter() {
  if (typeof sessionStorage === "undefined")
    return new VerificationAttemptLimiter();
  let initialState: { failures: number; blockedUntil: number } | undefined;
  try {
    initialState =
      JSON.parse(sessionStorage.getItem(VERIFICATION_LIMIT_KEY) ?? "null") ??
      undefined;
  } catch {
    /* Ignore corrupted client state. */
  }
  return new VerificationAttemptLimiter(Date.now, initialState, (state) => {
    sessionStorage.setItem(VERIFICATION_LIMIT_KEY, JSON.stringify(state));
  });
}

const verificationLimiter = createVerificationLimiter();

function readPendingIdentity(
  metadata: Record<string, unknown>,
): MemberIdentity | null {
  const pending = metadata[PENDING_IDENTITY_KEY];
  if (!pending || typeof pending !== "object") return null;
  const candidate = pending as Record<string, unknown>;
  const identity = {
    licenceNumber: candidate.licenceNumber,
    lastName: candidate.lastName,
    firstName: candidate.firstName,
    birthDate: candidate.birthDate,
  };
  return Object.values(identity).every(
    (value) => typeof value === "string" && value.length > 0,
  )
    ? (identity as MemberIdentity)
    : null;
}

export const memberService = {
  async matchesLicence(identity: MemberIdentity): Promise<boolean> {
    if (!hasCompleteIdentity(identity)) return false;
    if (!verificationLimiter.canAttempt()) {
      throw new MemberRegistrationError("verification_rate_limited");
    }

    const { data, error } = await supabase.rpc(
      "find_member_by_licence",
      toRpcIdentity(identity),
    );

    if (error) {
      throw new MemberServiceError("vérifier", error.message, error.code);
    }

    const matches = data === true;
    verificationLimiter.recordResult(matches);
    return matches;
  },

  async linkCurrentProfile(identity: MemberIdentity): Promise<string> {
    if (!hasCompleteIdentity(identity)) {
      throw new MemberServiceError(
        "lier",
        "l’identité complète du licencié est requise",
      );
    }

    const { data, error } = await supabase.rpc(
      "link_profile_to_member",
      toRpcIdentity(identity),
    );

    if (error) {
      throw new MemberServiceError("lier", error.message, error.code);
    }

    return data as string;
  },

  async cleanupCurrentRegistration(): Promise<void> {
    const { error } = await supabase.functions.invoke(
      "cleanup-member-registration",
    );
    await supabase.auth.signOut();
    if (error) throw error;
  },

  async completeCurrentRegistration(identity: MemberIdentity): Promise<void> {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user)
      throw error ?? new MemberRegistrationError("unknown");
    const user = data.user;
    await completeMemberRegistrationWithCleanup(
      async () => {
        await profileService.getOrCreateProfile(mapSupabaseUser(user));
      },
      async () => {
        await this.linkCurrentProfile(identity);
      },
      async () => {
        await this.cleanupCurrentRegistration();
      },
    );
  },

  async finalizePendingRegistration(): Promise<boolean> {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return false;
    const identity = readPendingIdentity(data.user.user_metadata);
    if (!identity) return false;
    await this.completeCurrentRegistration(identity);
    await supabase.auth.updateUser({ data: { [PENDING_IDENTITY_KEY]: null } });
    return true;
  },

  async register(input: MemberRegistration): Promise<RegistrationOutcome> {
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: { data: { [PENDING_IDENTITY_KEY]: input.identity } },
    });

    if (error) throw mapRegistrationError(error);
    if (!data.user) throw new MemberRegistrationError("unknown");
    const outcome = getRegistrationOutcome(data.session !== null);
    if (outcome === "confirmation_required") return outcome;
    await this.completeCurrentRegistration(input.identity);
    await supabase.auth.updateUser({ data: { [PENDING_IDENTITY_KEY]: null } });
    await supabase.auth.signOut();
    return outcome;
  },
};
