import { supabase } from "@/infrastructure/supabase/client";

type MemberProfileRpcRow = {
  licence_number: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  season: string | null;
  is_licensed: boolean;
};

type MemberClubRpcRow = MemberProfileRpcRow & {
  club_id: string;
  club_name: string;
  member_id: string;
  affiliation_type: string | null;
  is_default: boolean;
};

export type MemberProfileDetails = {
  licenceNumber: string;
  season: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
};

export type MemberClubProfile = MemberProfileDetails & {
  clubId: string;
  clubName: string;
  memberId: string;
  affiliationType: string | null;
  isDefault: boolean;
};

const mapProfile = (row: MemberProfileRpcRow): MemberProfileDetails => ({
  licenceNumber: row.licence_number,
  season: row.season ?? "—",
  firstName: row.first_name,
  lastName: row.last_name,
  isActive: row.is_active && row.is_licensed,
});

export const memberProfileService = {
  async get(_memberId?: string): Promise<MemberProfileDetails | null> {
    const { data, error } = await supabase.rpc("get_my_member_profile");
    if (error) throw error;

    const row = (data as MemberProfileRpcRow[] | null)?.[0];
    return row ? mapProfile(row) : null;
  },

  async listClubs(): Promise<MemberClubProfile[]> {
    const { data, error } = await supabase.rpc("list_my_member_clubs");
    if (error) throw error;

    return ((data as MemberClubRpcRow[] | null) ?? []).map((row) => ({
      ...mapProfile(row),
      clubId: row.club_id,
      clubName: row.club_name,
      memberId: row.member_id,
      affiliationType: row.affiliation_type,
      isDefault: row.is_default,
    }));
  },
};
