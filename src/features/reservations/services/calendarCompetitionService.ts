import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
import type { CalendarSlot } from "@/features/reservations/domain/calendar";

export async function resolveCalendarCompetition(slot: CalendarSlot): Promise<{
  kind: "tournament" | "championship";
  competitionId: string;
  matchId: string;
} | null> {
  const { data, error } = await supabase.rpc("resolve_calendar_competition", {
    target_resource_id: slot.resourceId,
    target_starts_at: slot.startsAt,
    target_ends_at: slot.endsAt,
  });
  if (error)
    throw new Error(
      getSupabaseErrorMessage(error, "Impossible de retrouver la compétition."),
    );
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const result = data as Record<string, unknown>;
  if (
    (result.kind !== "tournament" && result.kind !== "championship") ||
    typeof result.competitionId !== "string" ||
    typeof result.matchId !== "string"
  )
    return null;
  return {
    kind: result.kind,
    competitionId: result.competitionId,
    matchId: result.matchId,
  };
}
