import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
import type { CalendarSlot } from "@/features/reservations/domain/calendar";

export type MatchContact = { name: string; phone: string | null; team: string };
export async function loadAdminCalendarMatchContacts(
  slot: CalendarSlot,
  clubId?: string,
): Promise<MatchContact[]> {
  const { data, error } = await supabase.rpc(
    clubId
      ? "admin_tournament_calendar_contacts_for_club"
      : "admin_calendar_match_contacts",
    {
      target_resource_id: slot.resourceId,
      target_starts_at: slot.startsAt,
      target_ends_at: slot.endsAt,
      ...(clubId ? { target_club_id: clubId } : {}),
    },
  );
  if (error)
    throw new Error(
      getSupabaseErrorMessage(error, "Impossible de charger les numéros."),
    );
  if (!Array.isArray(data)) return [];
  return data
    .filter(
      (row): row is MatchContact =>
        row !== null && typeof row === "object" && typeof row.name === "string",
    )
    .map((row) => ({
      name: row.name,
      phone: typeof row.phone === "string" ? row.phone : null,
      team: typeof row.team === "string" ? row.team : "",
    }));
}
