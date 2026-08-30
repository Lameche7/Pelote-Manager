import type { ReservationTerms } from "@/features/reservations/domain/booking";
import { supabase } from "@/infrastructure/supabase/client";

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

type PreparedPaymentRow = {
  payment_id: string;
  payment_status: PaymentStatus;
  redirect_url: string | null;
};

type ShareStatusRow = {
  payment_id: string;
  payment_status: PaymentStatus;
  reservation_status: string;
  amount_cents: number;
  currency: "EUR";
  expires_at: string;
  resource_name: string;
  starts_at: string;
  booker_name: string;
  paid_count: number;
  payment_count: number;
};

type PaymentStatus =
  | "pending"
  | "authorized"
  | "paid"
  | "failed"
  | "cancelled"
  | "refunded"
  | "expired";

export type StartedPayment = {
  reservationId: string;
  paymentId: string;
  amountCents: number;
  currency: "EUR";
  expiresAt: string;
  redirectUrl?: string;
  mode: "test" | "helloasso";
};

export type ReservationPaymentConfig = {
  enabled: boolean;
  mode: "test" | "helloasso";
};

export type ReservationPaymentPlayer = {
  profileId: string;
  displayName: string;
};

export type ReservationSharePayment = {
  paymentId: string;
  paymentStatus: PaymentStatus;
  reservationStatus: string;
  amountCents: number;
  currency: "EUR";
  expiresAt: string;
  resourceName: string;
  startsAt: string;
  bookerName: string;
  paidCount: number;
  paymentCount: number;
};

async function invokeHelloAssoCheckout(paymentId: string): Promise<string> {
  const { data: checkoutData, error: checkoutError } =
    await supabase.functions.invoke("create-helloasso-checkout", {
      body: { paymentId },
    });
  if (checkoutError) throw checkoutError;

  const checkout = checkoutData as CheckoutResponse | null;
  if (!checkout?.redirectUrl) {
    throw new Error(
      checkout?.error ?? "HelloAsso n’a pas retourné de lien de paiement.",
    );
  }
  return checkout.redirectUrl;
}

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

function simulateWithDialog(
  paymentId: string,
): Promise<"paid" | "failed" | "cancelled"> {
  const accepted = window.confirm(
    "MODE TEST — Aucun paiement réel ne sera effectué.\n\nOK : simuler un paiement accepté\nAnnuler : choisir un refus ou une annulation",
  );

  if (accepted) {
    return reservationBookingService
      .simulate(paymentId, "paid")
      .then(() => "paid" as const);
  }

  const refused = window.confirm(
    "Simuler un paiement refusé ?\n\nOK : paiement refusé\nAnnuler : paiement abandonné",
  );
  const outcome = refused ? "failed" : "cancelled";
  return reservationBookingService
    .simulate(paymentId, outcome)
    .then(() => outcome);
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

  async getPaymentConfig(): Promise<ReservationPaymentConfig> {
    const [
      { data: enabled, error: enabledError },
      { data: mode, error: modeError },
    ] = await Promise.all([
      supabase.rpc("get_online_payment_enabled"),
      supabase.rpc("get_payment_mode"),
    ]);
    if (enabledError) throw enabledError;
    if (modeError) throw modeError;
    return {
      enabled: enabled === true,
      mode: mode === "helloasso" ? "helloasso" : "test",
    };
  },

  async searchPaymentPlayers(
    resourceId: string,
    search: string,
  ): Promise<ReservationPaymentPlayer[]> {
    const { data, error } = await supabase.rpc(
      "search_reservation_payment_players",
      {
        target_resource_id: resourceId,
        search_text: search,
      },
    );
    if (error) throw error;

    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      profileId: String(row.profile_id),
      displayName: String(row.display_name),
    }));
  },

  async createDirect(resourceId: string, startsAt: string): Promise<void> {
    const { error } = await supabase.rpc("create_reservation", {
      target_resource_id: resourceId,
      target_starts_at: startsAt,
      guest_name: null,
      guest_email: null,
      guest_phone: null,
    });
    if (error) throw error;
  },

  async startPayment(
    resourceId: string,
    startsAt: string,
    mode: "test" | "helloasso",
  ): Promise<StartedPayment> {
    const { data, error } = await supabase.rpc("reserve_for_payment", {
      target_resource_id: resourceId,
      target_starts_at: startsAt,
      guest_name: null,
      guest_email: null,
      guest_phone: null,
    });
    if (error) throw error;

    const payment = (data as PaymentReservationRow[] | null)?.[0];
    if (!payment) {
      throw new Error(
        "La réservation en attente de paiement n’a pas été créée.",
      );
    }

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
      const redirectUrl = await invokeHelloAssoCheckout(payment.payment_id);
      return {
        reservationId: payment.reservation_id,
        paymentId: payment.payment_id,
        amountCents: payment.amount_cents,
        currency: payment.currency,
        expiresAt: payment.expires_at,
        redirectUrl,
        mode,
      };
    } catch (checkoutError) {
      const reason =
        checkoutError instanceof Error
          ? checkoutError.message
          : "Erreur inconnue";
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

  async createSplit(
    resourceId: string,
    startsAt: string,
    partnerProfileIds: string[],
  ): Promise<StartedPayment> {
    const { data, error } = await supabase.rpc("reserve_for_split_payment", {
      target_resource_id: resourceId,
      target_starts_at: startsAt,
      partner_profile_ids: partnerProfileIds,
    });
    if (error) throw error;

    const payment = (data as PaymentReservationRow[] | null)?.[0];
    if (!payment) {
      throw new Error("Le paiement partagé n’a pas pu être préparé.");
    }

    const config = await this.getPaymentConfig();
    return {
      reservationId: payment.reservation_id,
      paymentId: payment.payment_id,
      amountCents: payment.amount_cents,
      currency: payment.currency,
      expiresAt: payment.expires_at,
      mode: config.mode,
    };
  },

  async getSharePayment(paymentId: string): Promise<ReservationSharePayment> {
    const { data, error } = await supabase.rpc(
      "get_my_reservation_payment_share",
      { target_payment_id: paymentId },
    );
    if (error) throw error;

    const row = (data as ShareStatusRow[] | null)?.[0];
    if (!row) throw new Error("Cette part de paiement est introuvable.");

    return {
      paymentId: row.payment_id,
      paymentStatus: row.payment_status,
      reservationStatus: row.reservation_status,
      amountCents: row.amount_cents,
      currency: row.currency,
      expiresAt: row.expires_at,
      resourceName: row.resource_name,
      startsAt: row.starts_at,
      bookerName: row.booker_name,
      paidCount: Number(row.paid_count),
      paymentCount: Number(row.payment_count),
    };
  },

  async payAssignedShare(paymentId: string): Promise<void> {
    const { data, error } = await supabase.rpc(
      "prepare_my_reservation_payment",
      { target_payment_id: paymentId },
    );
    if (error) throw error;

    const prepared = (data as PreparedPaymentRow[] | null)?.[0];
    if (!prepared) throw new Error("Cette part de paiement est introuvable.");
    if (prepared.payment_status === "paid") return;

    const config = await this.getPaymentConfig();
    if (config.mode === "test") {
      await simulateWithDialog(paymentId);
      return;
    }

    try {
      const redirectUrl =
        prepared.redirect_url ?? (await invokeHelloAssoCheckout(paymentId));
      window.location.assign(redirectUrl);
      await new Promise<void>(() => undefined);
    } catch (checkoutError) {
      throw new Error(
        checkoutError instanceof Error
          ? `Impossible d’ouvrir HelloAsso : ${checkoutError.message}`
          : "Impossible d’ouvrir HelloAsso. Réessayez dans quelques instants.",
      );
    }
  },

  async simulate(
    paymentId: string,
    outcome: "paid" | "failed" | "cancelled",
  ): Promise<void> {
    const { error } = await supabase.rpc("simulate_payment", {
      target_payment_id: paymentId,
      simulated_outcome: outcome,
    });
    if (error) throw error;
  },

  async create(resourceId: string, startsAt: string): Promise<void> {
    const config = await this.getPaymentConfig();

    if (!config.enabled) {
      await this.createDirect(resourceId, startsAt);
      return;
    }

    const payment = await this.startPayment(resourceId, startsAt, config.mode);

    if (payment.mode === "helloasso" && payment.redirectUrl) {
      window.location.assign(payment.redirectUrl);
      await new Promise<void>(() => undefined);
      return;
    }

    const outcome = await simulateWithDialog(payment.paymentId);
    if (outcome === "paid") return;

    throw new Error(
      outcome === "failed"
        ? "Paiement refusé en mode test. Le créneau a été libéré."
        : "Paiement annulé en mode test. Le créneau a été libéré.",
    );
  },
};
