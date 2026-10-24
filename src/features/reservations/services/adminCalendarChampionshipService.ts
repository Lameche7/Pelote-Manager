import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
import type { CalendarSlot } from "@/features/reservations/domain/calendar";

export type ChampionshipCalendarCandidate = {
  id: string;
  label: string;
  plannedDate: string | null;
};

const args = (slot: CalendarSlot) => ({
  target_resource_id: slot.resourceId,
  target_starts_at: slot.startsAt,
  target_ends_at: slot.endsAt,
});

export const adminCalendarChampionshipService = {
  async candidates(
    slot: CalendarSlot,
  ): Promise<ChampionshipCalendarCandidate[]> {
    const { data, error } = await supabase.rpc(
      "admin_calendar_championship_candidates",
      args(slot),
    );
    if (error)
      throw new Error(
        getSupabaseErrorMessage(error, "Impossible de charger les rencontres."),
      );
    return (
      (data ?? []) as {
        match_id: string;
        label: string;
        planned_date: string | null;
      }[]
    ).map((m) => ({
      id: m.match_id,
      label: m.label,
      plannedDate: m.planned_date,
    }));
  },
  async occupiedReservationId(slot: CalendarSlot): Promise<string> {
    const { data, error } = await supabase.rpc(
      "admin_calendar_reservation_for_conversion",
      args(slot),
    );
    if (error || typeof data !== "string")
      throw new Error(
        getSupabaseErrorMessage(error, "Réservation ordinaire introuvable."),
      );
    return data;
  },
  async conversionCandidates(
    reservationId: string,
  ): Promise<ChampionshipCalendarCandidate[]> {
    const { data, error } = await supabase.rpc(
      "admin_championship_matches_for_reservation",
      { target_reservation_id: reservationId },
    );
    if (error)
      throw new Error(
        getSupabaseErrorMessage(error, "Impossible de charger les rencontres."),
      );
    return (
      (data ?? []) as {
        match_id: string;
        label: string;
        planned_date: string | null;
      }[]
    ).map((m) => ({
      id: m.match_id,
      label: m.label,
      plannedDate: m.planned_date,
    }));
  },
  async convertReservation(
    reservationId: string,
    matchId: string,
  ): Promise<void> {
    const { error } = await supabase.rpc(
      "admin_convert_reservation_to_championship",
      { target_reservation_id: reservationId, target_match_id: matchId },
    );
    if (error)
      throw new Error(getSupabaseErrorMessage(error, "Conversion impossible."));
  },
  async book(slot: CalendarSlot, matchId: string): Promise<void> {
    const { error } = await supabase.rpc("admin_calendar_book_championship", {
      ...args(slot),
      target_match_id: matchId,
    });
    if (error)
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de programmer cette partie.",
        ),
      );
  },
};
