import { supabase } from "@/infrastructure/supabase/client";
import { profileService } from "@/infrastructure/profile/profileService";
import {
  completeMemberRegistration,
  mapRegistrationError,
  MemberRegistrationError,
} from "@/features/members/domain/memberRegistration";
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

export const memberService = {
  async matchesLicence(identity: MemberIdentity): Promise<boolean> {
    if (!hasCompleteIdentity(identity)) return false;

    const { data, error } = await supabase.rpc(
      "find_member_by_licence",
      toRpcIdentity(identity),
    );

    if (error) {
      throw new MemberServiceError("vérifier", error.message, error.code);
    }

    return data === true;
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

  async register(input: MemberRegistration): Promise<void> {
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
    });

    if (error) throw mapRegistrationError(error);
    if (!data.user || !data.session) {
      throw new MemberRegistrationError("unknown");
    }
    const user = data.user;

    await completeMemberRegistration(
      async () => {
        await profileService.createProfile({
          id: user.id,
          email: input.email,
        });
      },
      async () => {
        await this.linkCurrentProfile(input.identity);
      },
      async () => {
        const { error: cleanupError } = await supabase.functions.invoke(
          "rollback-member-registration",
        );
        await supabase.auth.signOut();
        if (cleanupError) throw cleanupError;
      },
    );

    await supabase.auth.signOut();
  },
};
