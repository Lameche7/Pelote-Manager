import { supabase } from "@/infrastructure/supabase/client";
import type { PaymentStatus } from "@/features/reservations/services/reservationPaymentService";

export type AdminPayment = {
  id: string;
  reservationId: string;
  customerName: string;
  customerEmail: string;
  resourceName: string;
  startsAt: string;
  amountCents: number;
  currency: "EUR";
  status: PaymentStatus;
  checkoutIntentId: string | null;
  orderId: string | null;
  providerPaymentId: string | null;
  failureReason: string | null;
  paidAt: string | null;
  expiresAt: string;
  createdAt: string;
};

type AdminPaymentRow = {
  id: string;
  reservation_id: string;
  customer_name: string;
  customer_email: string;
  resource_name: string;
  starts_at: string;
  amount_cents: number;
  currency: "EUR";
  status: PaymentStatus;
  provider_checkout_intent_id: string | null;
  provider_order_id: string | null;
  provider_payment_id: string | null;
  failure_reason: string | null;
  paid_at: string | null;
  expires_at: string;
  created_at: string;
};

export const adminPaymentService = {
  async list(filters: {
    status: PaymentStatus | "all";
    from: string;
    to: string;
  }): Promise<AdminPayment[]> {
    const { data, error } = await supabase.rpc("admin_list_payments", {
      status_filter: filters.status === "all" ? null : filters.status,
      range_start: new Date(`${filters.from}T00:00:00`).toISOString(),
      range_end: new Date(`${filters.to}T23:59:59.999`).toISOString(),
    });
    if (error) throw error;

    return ((data ?? []) as AdminPaymentRow[]).map((row) => ({
      id: row.id,
      reservationId: row.reservation_id,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      resourceName: row.resource_name,
      startsAt: row.starts_at,
      amountCents: row.amount_cents,
      currency: row.currency,
      status: row.status,
      checkoutIntentId: row.provider_checkout_intent_id,
      orderId: row.provider_order_id,
      providerPaymentId: row.provider_payment_id,
      failureReason: row.failure_reason,
      paidAt: row.paid_at,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    }));
  },

  async expireAbandoned(): Promise<number> {
    const { data, error } = await supabase.rpc("expire_abandoned_payments");
    if (error) throw error;
    return Number(data ?? 0);
  },
};