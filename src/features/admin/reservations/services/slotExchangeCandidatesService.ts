import { supabase } from "@/infrastructure/supabase/client";
import type { CalendarOccupation } from "@/features/reservations/domain/calendar";
import { reservationCalendarService } from "@/features/reservations/services/reservationCalendarService";

export type ExchangeCandidate = CalendarOccupation & {
  sourceKind: string;
  exchangeSupported: boolean;
};

export async function listExchangeCandidates(
  resourceId: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<ExchangeCandidate[]> {
  const { data, error } = await supabase.rpc("admin_slot_exchange_candidates", {
    target_resource_id: resourceId,
    range_start: rangeStart,
    range_end: rangeEnd,
  });
  if (error) {
    // The read-only candidate RPC may not yet be installed on the preview database.
    // Keep simulation usable without ever enabling writes based on inferred types.
    if (
      error.code !== "PGRST202" &&
      !/could not find the function|schema cache/i.test(error.message)
    )
      throw new Error(error.message);
    const occupations = await reservationCalendarService.listOccupations(
      resourceId,
      rangeStart,
      rangeEnd,
    );
    return occupations.map((item) => ({
      ...item,
      sourceKind:
        item.occupationType === "reservation" ? "reservation" : "unclassified",
      exchangeSupported: false,
    }));
  }
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.occupation_id),
    resourceId: String(row.resource_id),
    startsAt: String(row.starts_at),
    endsAt: String(row.ends_at),
    title: String(row.title),
    occupationType:
      String(row.source_kind) === "reservation" ||
      String(row.source_kind) === "championship"
        ? "reservation"
        : "match",
    sourceKind: String(row.source_kind),
    exchangeSupported: row.exchange_supported === true,
  }));
}
