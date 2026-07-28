import { supabase } from "@/infrastructure/supabase/client";
import type { GuestContact, ReservationTerms } from "@/features/reservations/domain/booking";

type TermsRow = {
  customer_type: ReservationTerms["customerType"];
  advance_hours: number;
  price_cents: number;
  max_active_reservations: number;
};

type PaymentReservationRow = {
  reservation_id: string;
  payment_id: string;
  amount_cents: number;
  currency: "EUR";
  expires_at: string;
};

type CheckoutResponse = {
  paymentId: string;
  redirectUrl: string;
  error?: string;
};

export type StartedPayment = {
  reservationId: string;
  paymentId: string;
  amountCents: number;
  currency: "EUR";
  expiresAt: string;
  redirectUrl: string;
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

  async startPayment(
    resourceId: string,
    startsAt: string,
    guestContact?: GuestContact,
  ): Promise<StartedPayment> {
    const { data, error } = await supabase.rpc("reserve_for_payment", {
      target_resource_id: resourceId,
      target_starts_at: startsAt,
      guest_name: guestContact?.name ?? null,
      guest_email: guestContact?.email ?? null,
      guest_phone: guestContact?.phone ?? null,
    });

    if (error) throw error;

    const payment = (data as PaymentReservationRow[] | null)?.[0];
    if (!payment) throw new Error("La réservation en attente de paiement n’a pas été créée.");

    const { data: checkoutData, error: checkoutError } = await supabase.functions.invoke(
      "create-helloasso-checkout",
      { body: { paymentId: payment.payment_id } },
    );

    if (checkoutError) throw checkoutError;

    const checkout = checkoutData as CheckoutResponse | null;
    if (!checkout?.redirectUrl) {
      throw new Error(checkout?.error ?? "HelloAsso n’a pas retourné de lien de paiement.");
    }

    return {
      reservationId: payment.reservation_id,
      paymentId: payment.payment_id,
      amountCents: payment.amount_cents,
      currency: payment.currency,
      expiresAt: payment.expires_at,
      redirectUrl: checkout.redirectUrl,
    };
  },

  async create(
    resourceId: string,
    startsAt: string,
    guestContact?: GuestContact,
  ): Promise<never> {
    const payment = await this.startPayment(resourceId, startsAt, guestContact);
    window.location.assign(payment.redirectUrl);
    return new Promise<never>(() => undefined);
  },
};