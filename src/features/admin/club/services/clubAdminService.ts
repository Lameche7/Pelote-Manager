import { supabase } from "@/infrastructure/supabase/client";

export type Club = {
  id: string;
  name: string;
  logoUrl: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  socialLinks: string;
  affiliationNumber: string;
  notes: string;
};
export type Season = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  isActive: boolean;
};
export type Price = {
  id: string;
  name: string;
  amountCents: number;
  audience: string;
  isActive: boolean;
};

const mapClub = (row: Record<string, unknown>): Club => ({
  id: String(row.id),
  name: String(row.name ?? ""),
  logoUrl: String(row.logo_url ?? ""),
  address: String(row.address ?? ""),
  phone: String(row.phone ?? ""),
  email: String(row.email ?? ""),
  website: String(row.website ?? ""),
  socialLinks: String(row.social_links ?? ""),
  affiliationNumber: String(row.affiliation_number ?? ""),
  notes: String(row.notes ?? ""),
});

async function currentClubId() {
  const { data, error } = await supabase.rpc("admin_current_club_id");
  if (error) throw error;
  return data as string;
}

export const clubAdminService = {
  async getClub() {
    const id = await currentClubId();
    const { data, error } = await supabase
      .from("clubs")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw error;
    return mapClub(data as Record<string, unknown>);
  },
  async updateClub(club: Club) {
    const { error } = await supabase
      .from("clubs")
      .update({
        name: club.name,
        logo_url: club.logoUrl || null,
        address: club.address || null,
        phone: club.phone || null,
        email: club.email || null,
        website: club.website || null,
        social_links: club.socialLinks || null,
        affiliation_number: club.affiliationNumber || null,
        notes: club.notes || null,
      })
      .eq("id", club.id);
    if (error) throw error;
  },
  async listSeasons(): Promise<Season[]> {
    const clubId = await currentClubId();
    const { data, error } = await supabase
      .from("club_seasons")
      .select("*")
      .eq("club_id", clubId)
      .order("starts_on", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      startsOn: r.starts_on,
      endsOn: r.ends_on,
      isActive: r.is_active,
    }));
  },
  async createSeason(value: Omit<Season, "id">) {
    const clubId = await currentClubId();
    const { error } = await supabase.from("club_seasons").insert({
      club_id: clubId,
      name: value.name,
      starts_on: value.startsOn,
      ends_on: value.endsOn,
      is_active: value.isActive,
    });
    if (error) throw error;
  },
  async deleteSeason(id: string) {
    const { error } = await supabase.from("club_seasons").delete().eq("id", id);
    if (error) throw error;
  },
  async listPrices(): Promise<Price[]> {
    const clubId = await currentClubId();
    const { data, error } = await supabase
      .from("club_prices")
      .select("*")
      .eq("club_id", clubId)
      .order("name");
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      amountCents: r.amount_cents,
      audience: r.audience,
      isActive: r.is_active,
    }));
  },
  async createPrice(value: Omit<Price, "id">) {
    const clubId = await currentClubId();
    const { error } = await supabase.from("club_prices").insert({
      club_id: clubId,
      name: value.name,
      amount_cents: value.amountCents,
      audience: value.audience,
      is_active: value.isActive,
    });
    if (error) throw error;
  },
  async deletePrice(id: string) {
    const { error } = await supabase.from("club_prices").delete().eq("id", id);
    if (error) throw error;
  },
};
