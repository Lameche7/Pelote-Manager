import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

export type EventStatus = "draft" | "published" | "archived";
export type EventVisibility = "public" | "members" | "private";
export type EventType = {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  displayOrder: number;
  isActive: boolean;
};
export type EventResource = { id: string; name: string };
export type EventResponsible = { profileId: string; name: string };
export type AdminEvent = {
  id: string;
  name: string;
  typeName: string;
  typeColor: string;
  startsAt: string;
  endsAt: string;
  resourceNames: string[];
  responsibleName: string | null;
  publicationStatus: EventStatus;
  visibility: EventVisibility;
  isBlocking: boolean;
};
export type EventDraft = {
  id?: string;
  name: string;
  eventTypeId: string;
  description: string;
  responsibleProfileId: string | null;
  color: string | null;
  startsAt: string;
  endsAt: string;
  resourceIds: string[];
  isBlocking: boolean;
  visibility: EventVisibility;
  publicationStatus: EventStatus;
  maximumCapacity: number | null;
  registrationRequired: boolean;
};

const fail = (error: unknown, fallback: string) => {
  throw new Error(getSupabaseErrorMessage(error, fallback));
};

export const eventAdminService = {
  async listEvents(): Promise<AdminEvent[]> {
    const { data, error } = await supabase.rpc("admin_list_events");
    if (error) fail(error, "Impossible de charger les évènements.");
    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      typeName: String(row.type_name),
      typeColor: String(row.type_color),
      startsAt: String(row.starts_at),
      endsAt: String(row.ends_at),
      resourceNames: row.resource_names as string[],
      responsibleName: row.responsible_name as string | null,
      publicationStatus: row.publication_status as EventStatus,
      visibility: row.visibility as EventVisibility,
      isBlocking: Boolean(row.is_blocking),
    }));
  },
  async listEventTypes(): Promise<EventType[]> {
    const { data, error } = await supabase.rpc("admin_list_event_types");
    if (error) fail(error, "Impossible de charger les types d’évènements.");
    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      color: String(row.color),
      icon: row.icon as string | null,
      displayOrder: Number(row.display_order),
      isActive: Boolean(row.is_active),
    }));
  },
  async listResources(): Promise<EventResource[]> {
    const { data, error } = await supabase.rpc("admin_list_event_resources");
    if (error) fail(error, "Impossible de charger les terrains.");
    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      name: String(row.name),
    }));
  },
  async listResponsibles(): Promise<EventResponsible[]> {
    const { data, error } = await supabase.rpc("admin_list_event_responsibles");
    if (error) fail(error, "Impossible de charger les responsables.");
    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      profileId: String(row.profile_id),
      name: String(row.name),
    }));
  },
  async createEventType(
    name: string,
    color: string,
    icon: string | null,
  ): Promise<string> {
    const { data, error } = await supabase.rpc("admin_save_event_type", {
      target_name: name,
      target_color: color,
      target_icon: icon,
    });
    if (error) fail(error, "Impossible de créer le type d’évènement.");
    return String(data);
  },
  async getEvent(id: string): Promise<EventDraft> {
    const { data, error } = await supabase.rpc("admin_get_event", {
      target_id: id,
    });
    if (error) fail(error, "Impossible de charger l’évènement.");
    const row = data as Record<string, unknown> | null;
    if (!row) throw new Error("Évènement introuvable.");
    return {
      id: String(row.id),
      name: String(row.name),
      eventTypeId: String(row.event_type_id),
      description: String(row.description ?? ""),
      responsibleProfileId: row.responsible_profile_id as string | null,
      color: row.color as string | null,
      startsAt: String(row.starts_at),
      endsAt: String(row.ends_at),
      resourceIds: row.resource_ids as string[],
      isBlocking: Boolean(row.is_blocking),
      visibility: row.visibility as EventVisibility,
      publicationStatus: row.publication_status as EventStatus,
      maximumCapacity:
        row.maximum_capacity === null ? null : Number(row.maximum_capacity),
      registrationRequired: Boolean(row.registration_required),
    };
  },
  async createEvent(event: EventDraft): Promise<string> {
    return this.updateEvent(event);
  },
  async updateEvent(event: EventDraft): Promise<string> {
    const { data, error } = await supabase.rpc("admin_save_event", {
      payload: {
        id: event.id ?? null,
        name: event.name,
        event_type_id: event.eventTypeId,
        description: event.description,
        responsible_profile_id: event.responsibleProfileId,
        color: event.color,
        starts_at: event.startsAt,
        ends_at: event.endsAt,
        resource_ids: event.resourceIds,
        is_blocking: event.isBlocking,
        visibility: event.visibility,
        publication_status: event.publicationStatus,
        maximum_capacity: event.maximumCapacity,
        registration_required: event.registrationRequired,
      },
    });
    if (error) fail(error, "Impossible d’enregistrer l’évènement.");
    return String(data);
  },
  async duplicateEvent(id: string): Promise<string> {
    const { data, error } = await supabase.rpc("admin_duplicate_event", {
      target_id: id,
    });
    if (error) fail(error, "Duplication impossible.");
    return String(data);
  },
  async archiveEvent(id: string): Promise<void> {
    const { error } = await supabase.rpc("admin_archive_event", {
      target_id: id,
    });
    if (error) fail(error, "Archivage impossible.");
  },
  async deleteEvent(id: string): Promise<void> {
    const { error } = await supabase.rpc("admin_delete_event", {
      target_id: id,
    });
    if (error) fail(error, "Suppression impossible.");
  },
};
