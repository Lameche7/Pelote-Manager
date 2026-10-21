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

type RefereedIntervalRow = {
  starts_at: string;
  ends_at: string;
  source_type: "championship" | "tournament";
};

type RefereeNameRow = {
  starts_at: string;
  ends_at: string;
  referee_name: string | null;
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

    // Referee decorations are nonessential to availability: do not hide the
    // entire timetable if either supplementary RPC temporarily fails.
    const [intervalResponse, nameResponse] = await Promise.allSettled([
      supabase.rpc("list_refereed_calendar_intervals", {
        target_resource_id: resourceId,
        range_start: fromDate,
        range_end: toDate,
      }),
      supabase.rpc("list_referee_names_for_calendar", {
        target_resource_id: resourceId,
        range_start: fromDate,
        range_end: toDate,
      }),
    ]);
    const refereedIntervals = intervalResponse.status === "fulfilled" && !intervalResponse.value.error
      ? intervalResponse.value.data : [];
    const refereeNames = nameResponse.status === "fulfilled" && !nameResponse.value.error
      ? nameResponse.value.data : [];
    const assignments = (refereeNames ?? []) as RefereeNameRow[];
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
      hasReferee: ((refereedIntervals ?? []) as RefereedIntervalRow[]).some((item) => new Date(item.starts_at).getTime() < new Date(slot.ends_at).getTime() && new Date(item.ends_at).getTime() > new Date(slot.starts_at).getTime()),
      refereeName: assignments.find((item) =>
        new Date(item.starts_at).getTime() < new Date(slot.ends_at).getTime() &&
        new Date(item.ends_at).getTime() > new Date(slot.starts_at).getTime()
      )?.referee_name ?? null,
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
