import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
import type {
  CalendarOccupation,
  CalendarOccupationRow,
  CalendarSlot,
  ReservableResource,
} from "@/features/reservations/domain/calendar";
import { mapCalendarOccupation } from "@/features/reservations/domain/calendar";

type ResourceRow = {
  id: string;
  club_id: string;
  name: string;
  description: string | null;
  timezone: string;
};

type SlotRow = {
  resource_id: string;
  starts_at: string;
  ends_at: string;
  status: "available" | "occupied" | "locked";
  booking_opens_at: string | null;
  booked_by_name: string | null;
  occupation_type: string | null;
  display_color: string | null;
  reservation_access: "standard" | "championship" | null;
  result_display: string | null;
};

export const reservationCalendarService = {
  async listResources(): Promise<ReservableResource[]> {
    const { data, error } = await supabase
      .from("reservable_resources")
      .select("id, club_id, name, description, timezone")
      .eq("is_active", true)
      .order("name");

    if (error)
      throw new Error(
        getSupabaseErrorMessage(error, "Impossible de charger les terrains."),
      );

    return ((data ?? []) as ResourceRow[]).map((resource) => ({
      id: resource.id,
      clubId: resource.club_id,
      name: resource.name,
      description: resource.description,
      timezone: resource.timezone,
    }));
  },

  async listSlots(
    resourceId: string,
    fromDate: string,
    toDate: string,
  ): Promise<CalendarSlot[]> {
    const { data, error } = await supabase.rpc("list_available_slots_v4", {
      target_resource_id: resourceId,
      range_start: fromDate,
      range_end: toDate,
    });

    if (error)
      throw new Error(
        getSupabaseErrorMessage(error, "Impossible de charger le calendrier."),
      );

    const refereeResponse = await supabase.from("referee_assignments").select("championship_match_id").not("referee_profile_id", "is", null);
    const refereeIds = new Set((refereeResponse.data ?? []).map((item) => item.championship_match_id).filter(Boolean));
    const reservationResponse = await supabase.from("reservations").select("championship_match_id, starts_at, ends_at").eq("resource_id", resourceId).in("status", ["pending", "confirmed"]).not("championship_match_id", "is", null);
    const refereedReservations = (reservationResponse.data ?? []).filter((item) => refereeIds.has(item.championship_match_id));
    return ((data ?? []) as SlotRow[]).map((slot) => ({
      resourceId: slot.resource_id,
      startsAt: slot.starts_at,
      endsAt: slot.ends_at,
      status: slot.status,
      bookingOpensAt: slot.booking_opens_at,
      bookedByName: slot.booked_by_name,
      occupationType: slot.occupation_type,
      displayColor: slot.display_color,
      reservationAccess: slot.reservation_access,
      resultDisplay: slot.result_display,
      hasReferee: refereedReservations.some((item) => item.starts_at < slot.ends_at && item.ends_at > slot.starts_at),
    }));
  },

  async listOccupations(
    resourceId: string,
    rangeStart: string,
    rangeEnd: string,
  ): Promise<CalendarOccupation[]> {
    const { data, error } = await supabase.rpc("list_calendar_occupations", {
      target_resource_id: resourceId,
      range_start: rangeStart,
      range_end: rangeEnd,
    });

    if (error)
      throw new Error(
        getSupabaseErrorMessage(error, "Impossible de charger les occupations."),
      );

    return ((data ?? []) as CalendarOccupationRow[]).map(
      mapCalendarOccupation,
    );
  },
};
