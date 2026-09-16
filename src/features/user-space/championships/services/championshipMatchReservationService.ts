import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

type Row = Record<string, unknown>;

export type ChampionshipMatchReservationContext = {
  matchId: string;
  championshipId: string;
  championshipName: string;
  championshipStatus: string;
  divisionId: string;
  divisionName: string;
  displayColor: string | null;
  team1Label: string;
  team2Label: string;
  matchPaymentMode: "free" | "standard";
  onlinePaymentEnabled: boolean;
  existingReservation: {
    id: string;
    resourceId: string;
    startsAt: string;
    endsAt: string;
    status: string;
  } | null;
};

type PaymentReservationRow = {
  reservation_id: string;
  payment_id: string;
  amount_cents: number;
  currency: string;
  expires_at: string;
};

type CheckoutResponse = {
  redirectUrl?: string;
  error?: string;
};

const nullableString = (value: unknown) =>
  value === null || value === undefined || value === "" ? null : String(value);

const mapContext = (value: unknown): ChampionshipMatchReservationContext => {
  const row = (value ?? {}) as Row;
  const existing = row.existing_reservation as Row | null | undefined;
  return {
    matchId: String(row.match_id ?? ""),
    championshipId: String(row.championship_id ?? ""),
    championshipName: String(row.championship_name ?? ""),
    championshipStatus: String(row.championship_status ?? ""),
    divisionId: String(row.division_id ?? ""),
    divisionName: String(row.division_name ?? ""),
    displayColor: nullableString(row.display_color),
    team1Label: String(row.team1_label ?? ""),
    team2Label: String(row.team2_label ?? ""),
    matchPaymentMode: row.match_payment_mode === "standard" ? "standard" : "free",
    onlinePaymentEnabled: row.online_payment_enabled === true,
    existingReservation: existing
      ? {
          id: String(existing.id ?? ""),
          resourceId: String(existing.resource_id ?? ""),
          startsAt: String(existing.starts_at ?? ""),
          endsAt: String(existing.ends_at ?? ""),
          status: String(existing.status ?? ""),
        }
      : null,
  };
};

async function checkoutPayment(payment: PaymentReservationRow): Promise<void> {
  const { data: mode, error: modeError } = await supabase.rpc("get_payment_mode");
  if (modeError) throw modeError;

  if (mode !== "helloasso") {
    const accepted = window.confirm(
      "MODE TEST — Aucun paiement réel ne sera effectué.\n\nOK : simuler un paiement accepté\nAnnuler : simuler un paiement abandonné",
    );
    const { error } = await supabase.rpc("simulate_payment", {
      target_payment_id: payment.payment_id,
      simulated_outcome: accepted ? "paid" : "cancelled",
    });
    if (error) throw error;
    if (!accepted) {
      throw new Error("Paiement annulé en mode test. Le créneau a été libéré.");
    }
    return;
  }

  const { data, error } = await supabase.functions.invoke(
    "create-helloasso-checkout",
    { body: { paymentId: payment.payment_id } },
  );
  if (error) {
    await supabase.rpc("cancel_unstarted_payment", {
      target_payment_id: payment.payment_id,
      target_reservation_id: payment.reservation_id,
      cancellation_reason: error.message,
    });
    throw error;
  }

  const checkout = data as CheckoutResponse | null;
  if (!checkout?.redirectUrl) {
    await supabase.rpc("cancel_unstarted_payment", {
      target_payment_id: payment.payment_id,
      target_reservation_id: payment.reservation_id,
      cancellation_reason:
        checkout?.error ?? "HelloAsso n’a pas retourné de lien de paiement.",
    });
    throw new Error(
      checkout?.error ?? "HelloAsso n’a pas retourné de lien de paiement.",
    );
  }

  window.location.assign(checkout.redirectUrl);
  await new Promise<void>(() => undefined);
}

export const championshipMatchReservationService = {
  async getContext(matchId: string): Promise<ChampionshipMatchReservationContext> {
    const { data, error } = await supabase.rpc(
      "get_my_championship_reservation_context",
      { target_match_id: matchId },
    );
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de préparer la réservation de cette rencontre.",
        ),
      );
    }
    const context = mapContext(data);
    if (!context.matchId) {
      throw new Error("Cette rencontre n’est pas disponible à la réservation.");
    }
    return context;
  },

  async create(
    context: ChampionshipMatchReservationContext,
    resourceId: string,
    startsAt: string,
  ): Promise<void> {
    if (context.existingReservation) {
      throw new Error("Cette rencontre possède déjà une réservation active.");
    }

    if (context.matchPaymentMode === "standard" && context.onlinePaymentEnabled) {
      const { data, error } = await supabase.rpc(
        "reserve_my_championship_match_for_payment",
        {
          target_match_id: context.matchId,
          target_resource_id: resourceId,
          target_starts_at: startsAt,
        },
      );
      if (error) {
        throw new Error(
          getSupabaseErrorMessage(error, "Impossible de préparer le paiement."),
        );
      }
      const payment = (data as PaymentReservationRow[] | null)?.[0];
      if (!payment) throw new Error("Le paiement n’a pas pu être préparé.");
      await checkoutPayment(payment);
      return;
    }

    const { error } = await supabase.rpc(
      "create_my_championship_match_reservation",
      {
        target_match_id: context.matchId,
        target_resource_id: resourceId,
        target_starts_at: startsAt,
      },
    );
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de réserver ce créneau pour la rencontre.",
        ),
      );
    }
  },
};
