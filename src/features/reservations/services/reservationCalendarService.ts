import { supabase } from "@/infrastructure/supabase/client";
import type {
  CalendarOccupation,
  CalendarSlot,
  ReservableResource,
} from "@/features/reservations/domain/calendar";

type ResourceRow = {
  id: string;
  name: string;
  description: string | null;
  timezone: string;
};

type SlotRow = {
  resource_id: string;
  starts_at: string;
  ends_at: string;
  status: "available" | "occupied";
};

type OccupationRow = {
  id: string;
  occupation_type: CalendarOccupation["occupationType"];
  title: string;
  starts_at: string;
  ends_at: string;
};

export const reservationCalendarService = {
  async listResources(): Promise<ReservableResource[]> {
    const { data, error } = await supabase
      .from("reservable_resources")
      .select("id, name, description, timezone")
      .eq("is_active", true)
      .order("name");

    if (error) throw error;

    return ((data ?? []) as ResourceRow[]).map((resource) => ({
      id: resource.id,
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
    const { data, error } = await supabase.rpc("list_available_slots", {
      target_resource_id: resourceId,
      range_start: fromDate,
      range_end: toDate,
    });

    if (error) throw error;

    return ((data ?? []) as SlotRow[]).map((slot) => ({
      resourceId: slot.resource_id,
      startsAt: slot.starts_at,
      endsAt: slot.ends_at,
      status: slot.status,
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

    if (error) throw error;

    return ((data ?? []) as OccupationRow[]).map((occupation) => ({
      id: occupation.id,
      occupationType: occupation.occupation_type,
      title: occupation.title,
      startsAt: occupation.starts_at,
      endsAt: occupation.ends_at,
    }));
  },
};
