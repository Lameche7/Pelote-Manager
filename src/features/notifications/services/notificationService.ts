import type { CommunicationPriority } from "@/features/communication/domain/communication";
import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

export const NOTIFICATIONS_CHANGED_EVENT = "pelote:notifications-changed";

export type MemberNotification = {
  deliveryId: string;
  communicationId: string;
  title: string;
  body: string;
  priority: CommunicationPriority;
  publishedAt: string;
  expiresAt: string | null;
  readAt: string | null;
  isActive: boolean;
  actionUrl: string | null;
};

export type MemberHomeBanner = {
  communicationId: string;
  title: string;
  body: string;
  priority: CommunicationPriority;
  publishedAt: string;
  expiresAt: string | null;
};

const fail = (error: unknown, fallback: string): never => {
  throw new Error(getSupabaseErrorMessage(error, fallback));
};

const notifyChanged = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
  }
};

export const notificationService = {
  async listMyNotifications(): Promise<MemberNotification[]> {
    const { data, error } = await supabase.rpc("list_my_notifications_v2");
    if (error) fail(error, "Impossible de charger vos notifications.");
    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      deliveryId: String(row.delivery_id),
      communicationId: String(row.communication_id),
      title: String(row.title),
      body: String(row.body),
      priority: row.priority as CommunicationPriority,
      publishedAt: String(row.published_at),
      expiresAt: row.expires_at as string | null,
      readAt: row.read_at as string | null,
      isActive: Boolean(row.is_active),
      actionUrl: (row.action_url as string | null) ?? null,
    }));
  },

  async countUnread(): Promise<number> {
    const { data, error } = await supabase.rpc("count_my_unread_notifications");
    if (error)
      fail(error, "Impossible de charger le compteur de notifications.");
    return Number(data ?? 0);
  },

  async markRead(deliveryId: string, read: boolean): Promise<void> {
    const { error } = await supabase.rpc("mark_my_notification_read", {
      target_delivery_id: deliveryId,
      target_read: read,
    });
    if (error) fail(error, "Impossible de modifier la notification.");
    notifyChanged();
  },

  async listHomeBanners(): Promise<MemberHomeBanner[]> {
    const { data, error } = await supabase.rpc("list_my_home_banners");
    if (error) fail(error, "Impossible de charger les informations du club.");
    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      communicationId: String(row.communication_id),
      title: String(row.title),
      body: String(row.body),
      priority: row.priority as CommunicationPriority,
      publishedAt: String(row.published_at),
      expiresAt: row.expires_at as string | null,
    }));
  },
};
