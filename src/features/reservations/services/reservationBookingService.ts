import { supabase } from "@/infrastructure/supabase/client";
import type {
  CreatedReservation,
  GuestContact,
  ReservationTerms,
} from "@/features/reservations/domain/booking";

type TermsRow = {
  customer_type: ReservationTerms["customerType"];
  advance_hours: number;
  price_cents: number;
  max_active_reservations: number;
};

type ReservationRow = {
  id: string;
  resource_id: string;
  starts_at: string;
  ends_at: string;
  customer_type: CreatedReservation["customerType"];
  status: "confirmed";
  price_cents: number;
  currency: "EUR";
};

export const reservationBookingService = {
  async getTerms(startsAt: string): Promise<ReservationTerms> {
    const { data, error } = await supabase.rpc("get_current_reservation_terms", {
      target_starts_at: startsAt,
    });

    if (error) throw error;

    const row = (data as TermsRow[] | null)?.[0];
    if (!row) throw new Error("Conditions de réservation introuvables");

    return {
      customerType: row.customer_type,
      advanceHours: row.advance_hours,
      priceCents: row.price_cents,
      maxActiveReservations: row.max_active_reservations,
    };
  },

  async create(
    resourceId: string,
    startsAt: string,
    guestContact?: GuestContact,
  ): Promise<CreatedReservation> {
    const { data, error } = await supabase.rpc("create_reservation", {
      target_resource_id: resourceId,
      target_starts_at: startsAt,
      guest_name: guestContact?.name ?? null,
      guest_email: guestContact?.email ?? null,
      guest_phone: guestContact?.phone ?? null,
    });

    if (error) throw error;

    const row = data as ReservationRow | null;
    if (!row) throw new Error("Réservation non créée");

    return {
      id: row.id,
      resourceId: row.resource_id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      customerType: row.customer_type,
      status: row.status,
      priceCents: row.price_cents,
      currency: row.currency,
    };
  },
};
