import { localInputToStoredDateTime } from "@/features/admin/events/domain/eventDateTime";
import type {
  CommunicationPriority,
  CommunicationStatus,
} from "@/features/communication/domain/communication";
import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

export type AdminCommunication = {
  id: string;
  title: string;
  body: string;
  priority: CommunicationPriority;
  status: CommunicationStatus;
  showOnHome: boolean;
  publishedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  totalRecipients: number;
  inAppRecipients: number;
  readRecipients: number;
  unreadRecipients: number;
  withoutAccount: number;
  emailAvailable: number;
};

export type CommunicationDraft = {
  id?: string;
  title: string;
  body: string;
  priority: CommunicationPriority;
  showOnHome: boolean;
  expiresAt: string;
};

const fail = (error: unknown, fallback: string): never => {
  throw new Error(getSupabaseErrorMessage(error, fallback));
};

const mapCommunication = (
  row: Record<string, unknown>,
): AdminCommunication => ({
  id: String(row.id),
  title: String(row.title),
  body: String(row.body),
  priority: row.priority as CommunicationPriority,
  status: row.status as CommunicationStatus,
  showOnHome: Boolean(row.show_on_home),
  publishedAt: row.published_at as string | null,
  expiresAt: row.expires_at as string | null,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
  totalRecipients: Number(row.total_recipients ?? 0),
  inAppRecipients: Number(row.in_app_recipients ?? 0),
  readRecipients: Number(row.read_recipients ?? 0),
  unreadRecipients: Number(row.unread_recipients ?? 0),
  withoutAccount: Number(row.without_account ?? 0),
  emailAvailable: Number(row.email_available ?? 0),
});

export const communicationAdminService = {
  async listCommunications(): Promise<AdminCommunication[]> {
    const { data, error } = await supabase.rpc("admin_list_communications");
    if (error) fail(error, "Impossible de charger les communications.");
    return ((data ?? []) as Record<string, unknown>[]).map(mapCommunication);
  },

  async getCommunication(id: string): Promise<CommunicationDraft> {
    const { data, error } = await supabase.rpc("admin_get_communication", {
      target_id: id,
    });
    if (error) fail(error, "Impossible de charger la communication.");
    const row = data as Record<string, unknown> | null;
    if (!row) throw new Error("Communication introuvable.");
    return {
      id: String(row.id),
      title: String(row.title),
      body: String(row.body),
      priority: row.priority as CommunicationPriority,
      showOnHome: Boolean(row.show_on_home),
      expiresAt: String(row.expires_at ?? ""),
    };
  },

  async saveCommunication(draft: CommunicationDraft): Promise<string> {
    const { data, error } = await supabase.rpc("admin_save_communication", {
      payload: {
        id: draft.id ?? null,
        title: draft.title,
        body: draft.body,
        priority: draft.priority,
        show_on_home: draft.showOnHome,
        expires_at: draft.expiresAt
          ? localInputToStoredDateTime(draft.expiresAt)
          : null,
      },
    });
    if (error) fail(error, "Impossible d’enregistrer la communication.");
    return String(data);
  },

  async publishCommunication(id: string): Promise<void> {
    const { error } = await supabase.rpc("admin_publish_communication", {
      target_id: id,
    });
    if (error) fail(error, "Impossible de publier la communication.");
  },

  async archiveCommunication(id: string): Promise<void> {
    const { error } = await supabase.rpc("admin_archive_communication", {
      target_id: id,
    });
    if (error) fail(error, "Impossible d’archiver la communication.");
  },
};
