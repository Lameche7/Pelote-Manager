import { supabase } from "@/infrastructure/supabase/client";

export type MemberLookup = {
  id: string;
  lastName: string;
  firstName: string;
  birthDate: string | null;
  season: string;
  isActive: boolean;
};

type MemberLookupRow = {
  id: string;
  last_name: string;
  first_name: string;
  birth_date: string | null;
  season: string;
  is_active: boolean;
};

export class MemberServiceError extends Error {
  readonly code: string | undefined;

  constructor(operation: string, message: string, code?: string) {
    super(`Impossible de ${operation} le licencié : ${message}`);
    this.name = "MemberServiceError";
    this.code = code;
  }
}

function normalizeLicenceNumber(licenceNumber: string): string {
  return licenceNumber.trim();
}

export const memberService = {
  async findByLicence(licenceNumber: string): Promise<MemberLookup | null> {
    const normalizedLicenceNumber = normalizeLicenceNumber(licenceNumber);
    if (!normalizedLicenceNumber) return null;

    const { data, error } = await supabase.rpc("find_member_by_licence", {
      licence_number: normalizedLicenceNumber,
    });

    if (error) {
      throw new MemberServiceError("rechercher", error.message, error.code);
    }

    const row = (data as MemberLookupRow[] | null)?.[0];
    return row
      ? {
          id: row.id,
          lastName: row.last_name,
          firstName: row.first_name,
          birthDate: row.birth_date,
          season: row.season,
          isActive: row.is_active,
        }
      : null;
  },

  async linkCurrentProfile(licenceNumber: string): Promise<string> {
    const normalizedLicenceNumber = normalizeLicenceNumber(licenceNumber);
    if (!normalizedLicenceNumber) {
      throw new MemberServiceError("lier", "le numéro de licence est requis");
    }

    const { data, error } = await supabase.rpc("link_profile_to_member", {
      licence_number: normalizedLicenceNumber,
    });

    if (error) {
      throw new MemberServiceError("lier", error.message, error.code);
    }

    return data as string;
  },
};
