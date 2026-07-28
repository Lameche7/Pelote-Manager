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

export type AdminReservation = {
  id: string;
  resourceName: string;
  customerName: string;
  customerEmail: string;
  customerType: "guest" | "account" | "licensee";
  status: ReservationStatus;
  startsAt: string;
  endsAt: string;
  priceCents: number;
  createdAt: string;
};

export type ReservationDashboard = {
  totalReservations: number;
  confirmedReservations: number;
  cancelledReservations: number;
  noShowReservations: number;
  licenseeReservations: number;
  publicReservations: number;
  theoreticalRevenueCents: number;
};

type ReservationRow = {
  id: string;
  resource_name: string;
  customer_name: string;
  customer_email: string;
  customer_type: AdminReservation["customerType"];
  status: ReservationStatus;
  starts_at: string;
  ends_at: string;
  price_cents: number;
  created_at: string;
};

type DashboardRow = {
  total_reservations: number;
  confirmed_reservations: number;
  cancelled_reservations: number;
  no_show_reservations: number;
  licensee_reservations: number;
  public_reservations: number;
  theoretical_revenue_cents: number;
};

export const adminReservationOperationsService = {
  async list(filters: {
    search?: string;
    status?: ReservationStatus | "all";
    from?: string;
    to?: string;
  }): Promise<AdminReservation[]> {
    const { data, error } = await supabase.rpc("list_admin_reservations", {
      search_text: filters.search || null,
      status_filter: filters.status === "all" ? null : filters.status || null,
      range_start: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : null,
      range_end: filters.to ? new Date(`${filters.to}T23:59:59.999`).toISOString() : null,
    });

    if (error) throw error;

    return ((data ?? []) as ReservationRow[]).map((row) => ({
      id: row.id,
      resourceName: row.resource_name,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      customerType: row.customer_type,
      status: row.status,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      priceCents: row.price_cents,
      createdAt: row.created_at,
    }));
  },

  async getDashboard(from: string, to: string): Promise<ReservationDashboard> {
    const { data, error } = await supabase.rpc("get_reservation_dashboard", {
      range_start: new Date(`${from}T00:00:00`).toISOString(),
      range_end: new Date(`${to}T23:59:59.999`).toISOString(),
    });

    if (error) throw error;
    const row = (data?.[0] ?? {}) as Partial<DashboardRow>;

    return {
      totalReservations: Number(row.total_reservations ?? 0),
      confirmedReservations: Number(row.confirmed_reservations ?? 0),
      cancelledReservations: Number(row.cancelled_reservations ?? 0),
      noShowReservations: Number(row.no_show_reservations ?? 0),
      licenseeReservations: Number(row.licensee_reservations ?? 0),
      publicReservations: Number(row.public_reservations ?? 0),
      theoreticalRevenueCents: Number(row.theoretical_revenue_cents ?? 0),
    };
  },

  async setStatus(id: string, status: ReservationStatus, reason?: string): Promise<void> {
    const { error } = await supabase.rpc("set_reservation_operational_status", {
      target_reservation_id: id,
      target_status: status,
      reason: reason || null,
    });
    if (error) throw error;
  },

  async expirePastPending(): Promise<number> {
    const { data, error } = await supabase.rpc("expire_past_pending_reservations");
    if (error) throw error;
    return Number(data ?? 0);
  },
};
