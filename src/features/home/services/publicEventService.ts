import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

export type PublicEventVisibility = "public" | "members";

export type PublicEvent = {
  id: string;
  name: string;
  description: string | null;
  typeName: string;
  typeColor: string;
  startsAt: string;
  endsAt: string;
  resourceNames: string[];
  visibility: PublicEventVisibility;
};

export const publicEventService = {
  async listUpcomingEvents(): Promise<PublicEvent[]> {
    const { data, error } = await supabase.rpc("list_upcoming_events");

    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de charger les prochains évènements.",
        ),
      );
    }

    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      description: row.description as string | null,
      typeName: String(row.type_name),
      typeColor: String(row.type_color),
      startsAt: String(row.starts_at),
      endsAt: String(row.ends_at),
      resourceNames: (row.resource_names ?? []) as string[],
      visibility: row.visibility as PublicEventVisibility,
    }));
  },
};
