import { supabase } from "@/infrastructure/supabase/client";
import {
  reservationRange,
  type AdminReservationFilters,
  type AccountType,
} from "../domain/adminReservations";

export type ManagedReservation = {
  id: string;
  resourceId: string;
  resourceName: string;
  customerName: string;
  customerEmail: string;
  customerType: AccountType;
  status: string;
  paymentStatus: string;
  startsAt: string;
  endsAt: string;
  priceCents: number;
  createdAt: string;
};

export type ReservationUser = {
  id: string;
  name: string;
  email: string;
  licenseNumber: string;
};

export const adminReservationsService = {
  async list(filters: AdminReservationFilters): Promise<ManagedReservation[]> {
    const range = reservationRange(filters.period);
    const { data, error } = await supabase.rpc("admin_manage_reservations", {
      search_text: filters.search || null,
      resource_filter: filters.resourceId === "all" ? null : filters.resourceId,
      status_filter: filters.status === "all" ? null : filters.status,
      customer_filter:
        filters.accountType === "all" ? null : filters.accountType,
      range_start: range.from,
      range_end: range.to,
    });
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      resourceId: String(row.resource_id),
      resourceName: String(row.resource_name),
      customerName: String(row.customer_name),
      customerEmail: String(row.customer_email ?? ""),
      customerType: row.customer_type as AccountType,
      status: String(row.status),
      paymentStatus: String(row.payment_status ?? "Non requis"),
      startsAt: String(row.starts_at),
      endsAt: String(row.ends_at),
      priceCents: Number(row.price_cents),
      createdAt: String(row.created_at),
    }));
  },
  async searchUsers(search: string): Promise<ReservationUser[]> {
    const { data, error } = await supabase.rpc(
      "admin_search_reservation_users",
      { search_text: search },
    );
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      email: String(row.email),
      licenseNumber: String(row.license_number ?? ""),
    }));
  },
  async create(userId: string, resourceId: string, startsAt: string) {
    if (!userId) throw new Error("Un utilisateur existant est obligatoire.");
    const { error } = await supabase.rpc("admin_create_reservation_for_user", {
      target_user_id: userId,
      target_resource_id: resourceId,
      target_starts_at: startsAt,
    });
    if (error) throw error;
  },
  async cancel(id: string, reason: string) {
    const { error } = await supabase.rpc("cancel_reservation", {
      target_reservation_id: id,
      cancellation_reason: reason,
    });
    if (error) throw error;
  },
  async move(id: string, resourceId: string, startsAt: string) {
    const { error } = await supabase.rpc("modify_reservation", {
      target_reservation_id: id,
      target_resource_id: resourceId,
      target_starts_at: startsAt,
    });
    if (error) throw error;
  },
};
