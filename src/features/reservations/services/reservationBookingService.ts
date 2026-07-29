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
  redirectUrl?: string;
  mode: "test" | "helloasso";
};

async function releasePendingReservation(
  payment: PaymentReservationRow,
  reason: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("cancel_unstarted_payment", {
    target_payment_id: payment.payment_id,
    target_reservation_id: payment.reservation_id,
    cancellation_reason: reason,
  });

  if (error) return false;
  return data === true;
}

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

  async getPaymentMode(): Promise<"test" | "helloasso"> {
    const { data, error } = await supabase.rpc("get_payment_mode");
    if (error) throw error;
    return data === "helloasso" ? "helloasso" : "test";
  },

  async startPayment(
    resourceId: string,
    startsAt: string,
    guestContact?: GuestContact,
  ): Promise<StartedPayment> {
    const mode = await this.getPaymentMode();
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

    if (mode === "test") {
      return {
        reservationId: payment.reservation_id,
        paymentId: payment.payment_id,
        amountCents: payment.amount_cents,
        currency: payment.currency,
        expiresAt: payment.expires_at,
        mode,
      };
    }

    try {
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
        mode,
      };
    } catch (checkoutError) {
      const reason = checkoutError instanceof Error ? checkoutError.message : "Erreur inconnue";
      const released = await releasePendingReservation(payment, reason);
      if (released) {
        throw new Error(
          "Le paiement n’a pas pu démarrer. Le créneau a été libéré : vous pouvez réessayer.",
        );
      }
      throw new Error(
        "Le paiement n’a pas pu démarrer et le créneau reste temporairement bloqué. Réessayez dans quelques minutes.",
      );
    }
  },

  async simulate(paymentId: string, outcome: "paid" | "failed" | "cancelled"): Promise<void> {
    const { error } = await supabase.rpc("simulate_payment", {
      target_payment_id: paymentId,
      simulated_outcome: outcome,
    });
    if (error) throw error;
  },

  async create(
    resourceId: string,
    startsAt: string,
    guestContact?: GuestContact,
  ): Promise<StartedPayment> {
    const payment = await this.startPayment(resourceId, startsAt, guestContact);

    if (payment.mode === "helloasso" && payment.redirectUrl) {
      window.location.assign(payment.redirectUrl);
      return new Promise<StartedPayment>(() => undefined);
    }

    const accepted = window.confirm(
      "MODE TEST — Aucun paiement réel ne sera effectué.\n\nOK : simuler un paiement accepté\nAnnuler : choisir un refus ou une annulation",
    );

    if (accepted) {
      await this.simulate(payment.paymentId, "paid");
      return payment;
    }

    const refused = window.confirm(
      "Simuler un paiement refusé ?\n\nOK : paiement refusé\nAnnuler : paiement abandonné",
    );
    const outcome = refused ? "failed" : "cancelled";
    await this.simulate(payment.paymentId, outcome);

    throw new Error(
      refused
        ? "Paiement refusé en mode test. Le créneau a été libéré."
        : "Paiement annulé en mode test. Le créneau a été libéré.",
    );
  },
};