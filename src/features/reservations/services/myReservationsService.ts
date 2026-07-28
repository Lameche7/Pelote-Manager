import { supabase } from "@/infrastructure/supabase/client";

export type ReservationStatus =
  | "draft"
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "refused"
  | "expired"
  | "no_show";

export type PaymentStatus =
  | "pending"
  | "authorized"
  | "paid"
  | "failed"
  | "cancelled"
  | "refunded"
  | "expired";

export type MyReservation = {
  id: string;
  resourceName: string;
  startsAt: string;
  endsAt: string;
  reservationStatus: ReservationStatus;
  paymentStatus: PaymentStatus;
  amountCents: number;
  currency: "EUR";
  paymentId: string | null;
  paymentExpiresAt: string | null;
  paymentRedirectUrl: string | null;
  cancellationDeadline: string;
  canCancel: boolean;
  createdAt: string;
};

type MyReservationRow = {
  id: string;
  resource_name: string;
  starts_at: string;
  ends_at: string;
  reservation_status: ReservationStatus;
  payment_status: PaymentStatus;
  amount_cents: number;
  currency: "EUR";
  payment_id: string | null;
  payment_expires_at: string | null;
  payment_redirect_url: string | null;
  cancellation_deadline: string;
  can_cancel: boolean;
  created_at: string;
};

export type CancellationResult = {
  refundRequired: boolean;
};

export const myReservationsService = {
  async list(): Promise<MyReservation[]> {
    const { data, error } = await supabase.rpc("list_my_reservations");
    if (error) throw error;

    return ((data ?? []) as MyReservationRow[]).map((row) => ({
      id: row.id,
      resourceName: row.resource_name,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      reservationStatus: row.reservation_status,
      paymentStatus: row.payment_status,
      amountCents: row.amount_cents,
      currency: row.currency,
      paymentId: row.payment_id,
      paymentExpiresAt: row.payment_expires_at,
      paymentRedirectUrl: row.payment_redirect_url,
      cancellationDeadline: row.cancellation_deadline,
      canCancel: row.can_cancel,
      createdAt: row.created_at,
    }));
  },

  async cancel(reservationId: string): Promise<CancellationResult> {
    const { data, error } = await supabase.rpc("cancel_my_reservation", {
      target_reservation_id: reservationId,
    });
    if (error) throw error;

    const row = (data as Array<{ refund_required: boolean }> | null)?.[0];
    return { refundRequired: Boolean(row?.refund_required) };
  },

  async resumePayment(reservation: MyReservation): Promise<string> {
    if (!reservation.paymentId) {
      throw new Error("Aucun paiement en attente n’est associé à cette réservation.");
    }

    if (reservation.paymentRedirectUrl) return reservation.paymentRedirectUrl;

    const { data, error } = await supabase.functions.invoke("create-helloasso-checkout", {
      body: { paymentId: reservation.paymentId },
    });
    if (error) throw error;

    const checkout = data as { redirectUrl?: string; error?: string } | null;
    if (!checkout?.redirectUrl) {
      throw new Error(checkout?.error ?? "Le lien de paiement HelloAsso est indisponible.");
    }

    return checkout.redirectUrl;
  },
};
