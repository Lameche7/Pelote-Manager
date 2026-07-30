import { supabase } from "@/infrastructure/supabase/client";

export type MemberProfileDetails = {
  licenceNumber: string;
  season: string;
  firstName: string;
  lastName: string;
};

export const memberProfileService = {
  async get(memberId: string): Promise<MemberProfileDetails | null> {
    const { data, error } = await supabase
      .from("club_members")
      .select("licence_number, season, first_name, last_name")
      .eq("id", memberId)
      .maybeSingle();
    if (error) throw error;
    return data
      ? {
          licenceNumber: data.licence_number,
          season: data.season,
          firstName: data.first_name,
          lastName: data.last_name,
        }
      : null;
  },
};
