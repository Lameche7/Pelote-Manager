import { supabase } from "@/infrastructure/supabase/client";

type MemberProfileRpcRow = {
  licence_number: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  season: string | null;
  is_licensed: boolean;
};

export type MemberProfileDetails = {
  licenceNumber: string;
  season: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
};

export const memberProfileService = {
  async get(_memberId?: string): Promise<MemberProfileDetails | null> {
    const { data, error } = await supabase.rpc("get_my_member_profile");
    if (error) throw error;

    const row = (data as MemberProfileRpcRow[] | null)?.[0];
    return row
      ? {
          licenceNumber: row.licence_number,
          season: row.season ?? "—",
          firstName: row.first_name,
          lastName: row.last_name,
          isActive: row.is_active && row.is_licensed,
        }
      : null;
  },
};
