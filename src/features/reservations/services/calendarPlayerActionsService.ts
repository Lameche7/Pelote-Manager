import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
import type { CalendarSlot } from "@/features/reservations/domain/calendar";
import { getCalendarPlayerActions } from "@/features/reservations/domain/calendarPlayerActions";

type MatchIdentity = {
  kind: "championship" | "tournament";
  matchId: string;
  isParticipant: boolean;
  isAssignedReferee: boolean;
  canVolunteerForRefereeing: boolean;
  hasResult: boolean;
  canSubmitResultNow: boolean;
  canRequestReport: boolean;
};

export async function resolveCalendarPlayerActions(slot: CalendarSlot) {
  const { data, error } = await supabase.rpc(
    "resolve_calendar_player_actions",
    {
      target_resource_id: slot.resourceId,
      target_starts_at: slot.startsAt,
      target_ends_at: slot.endsAt,
    },
  );
  if (error)
    throw new Error(
      getSupabaseErrorMessage(
        error,
        "Impossible de vérifier les droits de cette rencontre.",
      ),
    );
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const match = data as Partial<MatchIdentity>;
  if (
    (match.kind !== "championship" && match.kind !== "tournament") ||
    typeof match.matchId !== "string" ||
    !match.matchId
  )
    return null;
  const actions = getCalendarPlayerActions({
    identityResolved: true,
    kind: match.kind,
    isAuthenticated: true,
    isParticipant: match.isParticipant === true,
    isAssignedReferee: match.isAssignedReferee === true,
    canVolunteerForRefereeing: match.canVolunteerForRefereeing === true,
    hasResult: match.hasResult === true,
    canSubmitResultNow: match.canSubmitResultNow === true,
    canRequestReport: match.canRequestReport === true,
  });
  return {
    kind: match.kind,
    matchId: match.matchId,
    isAssignedReferee: match.isAssignedReferee === true,
    isParticipant: match.isParticipant === true,
    actions,
  };
}
