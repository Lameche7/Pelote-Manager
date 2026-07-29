import { supabase } from "@/infrastructure/supabase/client";

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
};
