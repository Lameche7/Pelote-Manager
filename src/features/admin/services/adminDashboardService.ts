import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

export type DashboardMetrics = {
  reservationsToday: number;
  reservationsNext7Days: number;
  activeMembers: number;
  linkedAccounts: number;
  paymentAlerts: number;
  upcomingClosures: number;
  upcomingEvents: number;
  activeCommunications: number;
  unreadDeliveries: number;
};

export type DashboardReservation = {
  id: string;
  resourceName: string;
  startsAt: string;
  endsAt: string;
  status: string;
};

export type DashboardClosure = {
  id: string;
  title: string;
  occupationType: string;
  resourceName: string;
  startsAt: string;
  endsAt: string;
};

export type DashboardEvent = {
  id: string;
  name: string;
  typeName: string;
  color: string;
  startsAt: string;
  endsAt: string;
  visibility: string;
};

export type DashboardCommunication = {
  id: string;
  title: string;
  priority: "normal" | "important" | "urgent";
  publishedAt: string;
  expiresAt: string | null;
  recipientCount: number;
  unreadCount: number;
};

export type DashboardActivity = {
  kind: "reservation" | "event" | "communication";
  entityId: string;
  label: string;
  occurredAt: string;
  targetPath: string;
};

export type AdminDashboard = {
  generatedAt: string;
  metrics: DashboardMetrics;
  nextReservations: DashboardReservation[];
  upcomingClosures: DashboardClosure[];
  upcomingEvents: DashboardEvent[];
  activeCommunications: DashboardCommunication[];
  recentActivity: DashboardActivity[];
};

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const asRows = (value: unknown): JsonRecord[] =>
  Array.isArray(value) ? value.map(asRecord) : [];

const asNumber = (value: unknown) => Number(value ?? 0);
const asString = (value: unknown) => String(value ?? "");

const mapDashboard = (payload: unknown): AdminDashboard => {
  const row = asRecord(payload);
  const metrics = asRecord(row.metrics);

  return {
    generatedAt: asString(row.generated_at),
    metrics: {
      reservationsToday: asNumber(metrics.reservations_today),
      reservationsNext7Days: asNumber(metrics.reservations_next_7_days),
      activeMembers: asNumber(metrics.active_members),
      linkedAccounts: asNumber(metrics.linked_accounts),
      paymentAlerts: asNumber(metrics.payment_alerts),
      upcomingClosures: asNumber(metrics.upcoming_closures),
      upcomingEvents: asNumber(metrics.upcoming_events),
      activeCommunications: asNumber(metrics.active_communications),
      unreadDeliveries: asNumber(metrics.unread_deliveries),
    },
    nextReservations: asRows(row.next_reservations).map((reservation) => ({
      id: asString(reservation.id),
      resourceName: asString(reservation.resource_name),
      startsAt: asString(reservation.starts_at),
      endsAt: asString(reservation.ends_at),
      status: asString(reservation.status),
    })),
    upcomingClosures: asRows(row.upcoming_closures).map((closure) => ({
      id: asString(closure.id),
      title: asString(closure.title),
      occupationType: asString(closure.occupation_type),
      resourceName: asString(closure.resource_name),
      startsAt: asString(closure.starts_at),
      endsAt: asString(closure.ends_at),
    })),
    upcomingEvents: asRows(row.upcoming_events).map((event) => ({
      id: asString(event.id),
      name: asString(event.name),
      typeName: asString(event.type_name),
      color: asString(event.color),
      startsAt: asString(event.starts_at),
      endsAt: asString(event.ends_at),
      visibility: asString(event.visibility),
    })),
    activeCommunications: asRows(row.active_communications).map(
      (communication) => ({
        id: asString(communication.id),
        title: asString(communication.title),
        priority: communication.priority as DashboardCommunication["priority"],
        publishedAt: asString(communication.published_at),
        expiresAt: communication.expires_at
          ? asString(communication.expires_at)
          : null,
        recipientCount: asNumber(communication.recipient_count),
        unreadCount: asNumber(communication.unread_count),
      }),
    ),
    recentActivity: asRows(row.recent_activity).map((activity) => ({
      kind: activity.kind as DashboardActivity["kind"],
      entityId: asString(activity.entity_id),
      label: asString(activity.label),
      occurredAt: asString(activity.occurred_at),
      targetPath: asString(activity.target_path),
    })),
  };
};

export const adminDashboardService = {
  async getDashboard(): Promise<AdminDashboard> {
    const { data, error } = await supabase.rpc("admin_get_dashboard");
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de charger le tableau de bord.",
        ),
      );
    }
    return mapDashboard(data);
  },
};
