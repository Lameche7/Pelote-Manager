import { supabase } from "@/infrastructure/supabase/client";

export type PaymentStatus =
  | "pending"
  | "authorized"
  | "paid"
  | "failed"
  | "cancelled"
  | "refunded"
  | "expired";

export type PaymentReturnStatus = {
  paymentId: string;
  paymentStatus: PaymentStatus;
  reservationStatus: string;
  amountCents: number;
  currency: "EUR";
  expiresAt: string;
  resourceName: string;
  startsAt: string;
};

type PaymentReturnRow = {
  payment_id: string;
  payment_status: PaymentStatus;
  reservation_status: string;
  amount_cents: number;
  currency: "EUR";
  expires_at: string;
  resource_name: string;
  starts_at: string;
};

export const reservationPaymentService = {
  async getReturnStatus(paymentId: string): Promise<PaymentReturnStatus> {
    const { data, error } = await supabase.rpc("get_payment_return_status", {
      target_payment_id: paymentId,
    });
    if (error) throw error;

    const row = (data as PaymentReturnRow[] | null)?.[0];
    if (!row) throw new Error("Paiement introuvable.");

    return {
      paymentId: row.payment_id,
      paymentStatus: row.payment_status,
      reservationStatus: row.reservation_status,
      amountCents: row.amount_cents,
      currency: row.currency,
      expiresAt: row.expires_at,
      resourceName: row.resource_name,
      startsAt: row.starts_at,
    };
  },
};