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
export type ReservationPrices = {
  licenseePriceCents: number;
  publicPriceCents: number;
};

type ReservationPricesRow = {
  licensee_price_cents: number;
  public_price_cents: number;
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
    return (data ?? []).map((row: any) => ({
      id: row.id,
      name: row.name,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      isActive: row.is_active,
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
  async getReservationPrices(): Promise<ReservationPrices> {
    const { data, error } = await supabase.rpc("admin_get_reservation_prices");
    if (error) throw error;

    const row = (data as ReservationPricesRow[] | null)?.[0];
    if (!row) throw new Error("Tarifs de réservation introuvables.");

    return {
      licenseePriceCents: row.licensee_price_cents,
      publicPriceCents: row.public_price_cents,
    };
  },
  async updateReservationPrices(value: ReservationPrices): Promise<void> {
    const { error } = await supabase.rpc("admin_update_reservation_prices", {
      new_licensee_price_cents: value.licenseePriceCents,
      new_public_price_cents: value.publicPriceCents,
    });
    if (error) throw error;
  },
};
