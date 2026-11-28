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

type FinalDayProgramRow = {
  starts_at: string;
  ends_at: string;
  display_name: string;
  display_color: string | null;
  series_id: string;
  published: boolean;
};

type FinalRoundRow = {
  starts_at: string;
  ends_at: string;
  final_round: string;
};

type RefereeNameRow = {
  starts_at: string;
  ends_at: string;
  referee_name: string | null;
};

type OrdinaryTeamRow = {
  resource_id: string;
  starts_at: string;
  team_one: string;
  team_two: string;
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
  async listResources(clubSlug?: string | null): Promise<ReservableResource[]> {
    const { data, error } = await supabase.rpc(
      "list_public_calendar_resources",
      { target_slug: clubSlug || null },
    );

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
    tournamentPlanningOnly = false,
  ): Promise<CalendarSlot[]> {
    const { data, error } = await supabase.rpc(tournamentPlanningOnly ? "list_public_tournament_planning_slots" : "list_available_slots_v4", {
      target_resource_id: resourceId,
      range_start: fromDate,
      range_end: toDate,
    });

    if (error)
      throw new Error(
        getSupabaseErrorMessage(error, "Impossible de charger le calendrier."),
      );

    // Optional participant labels are supplementary. An unavailable label RPC
    // must never make the booking calendar disappear.
    const teamResponse = await supabase.rpc("list_public_reservation_team_labels", {
      target_resource_id: resourceId,
      range_start: fromDate,
      range_end: toDate,
    });
    const teamRows = teamResponse.error ? [] : ((teamResponse.data ?? []) as OrdinaryTeamRow[]);
    const teamsByStart = new Map(
      teamRows.map((row) => [
        new Date(row.starts_at).getTime(),
        { teamOne: row.team_one, teamTwo: row.team_two },
      ]),
    );

    // Referee decorations are nonessential to availability: do not hide the
    // entire timetable if either supplementary RPC temporarily fails.
    const [intervalResponse, nameResponse, finalRoundResponse, finalDayResponse] = await Promise.allSettled([
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
      supabase.rpc("list_published_tournament_final_calendar_rounds", {
        target_resource_id: resourceId,
        range_start: fromDate,
        range_end: toDate,
      }),
      supabase.rpc("list_public_tournament_final_day_program", {
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
    const finalRounds: FinalRoundRow[] =
      finalRoundResponse.status === "fulfilled" && !finalRoundResponse.value.error
        ? ((finalRoundResponse.value.data ?? []) as FinalRoundRow[])
        : [];
    const calendarSlots: CalendarSlot[] = ((data ?? []) as SlotRow[]).map((slot) => ({
      resourceId: slot.resource_id,
      startsAt: slot.starts_at,
      endsAt: slot.ends_at,
      status: slot.status,
      bookingOpensAt: slot.booking_opens_at,
      bookedByName:
        slot.status === "occupied" && slot.occupation_type === "reservation"
          ? (() => {
              const teams = teamsByStart.get(new Date(slot.starts_at).getTime());
              return teams
                ? `${teams.teamOne} – ${teams.teamTwo}`
                : slot.booked_by_name;
            })()
          : slot.booked_by_name,
      occupationType: slot.occupation_type,
      ordinaryTeams: slot.status === "occupied" && slot.occupation_type === "reservation"
        ? teamsByStart.get(new Date(slot.starts_at).getTime()) ?? null
        : null,
      displayColor: slot.display_color,
      reservationAccess: slot.reservation_access,
      resultDisplay: slot.result_display,
      tournamentFinalRound:
        slot.status === "occupied" && slot.occupation_type === "match"
          ? finalRounds.find((item) =>
              new Date(item.starts_at).getTime() === new Date(slot.starts_at).getTime() &&
              new Date(item.ends_at).getTime() === new Date(slot.ends_at).getTime(),
            )?.final_round ?? null
          : null,
      hasReferee: ((refereedIntervals ?? []) as RefereedIntervalRow[]).some((item) => new Date(item.starts_at).getTime() < new Date(slot.ends_at).getTime() && new Date(item.ends_at).getTime() > new Date(slot.starts_at).getTime()),
      refereeName: assignments.find((item) =>
        new Date(item.starts_at).getTime() < new Date(slot.ends_at).getTime() &&
        new Date(item.ends_at).getTime() > new Date(slot.starts_at).getTime()
      )?.referee_name ?? null,
    }));

    // A reserved finals-day program is a locked organizer hold, not a
    // published match. Published fixtures retain their actual occupation card.
    const program: FinalDayProgramRow[] =
      finalDayResponse.status === "fulfilled" && !finalDayResponse.value.error
        ? ((finalDayResponse.value.data ?? []) as FinalDayProgramRow[])
        : [];
    const unpublished = program.filter((row) => !row.published);
    const remaining = calendarSlots.filter((slot) => {
      if (slot.status === "occupied") return true;
      return !unpublished.some((row) =>
        new Date(slot.startsAt).getTime() < new Date(row.ends_at).getTime() &&
        new Date(slot.endsAt).getTime() > new Date(row.starts_at).getTime(),
      );
    });
    for (const row of unpublished) {
      // Never introduce a duplicate or a misleading booking if another real
      // occupation overlaps (defense against stale program metadata).
      if (calendarSlots.some((slot) =>
        slot.status === "occupied" &&
        new Date(slot.startsAt).getTime() < new Date(row.ends_at).getTime() &&
        new Date(slot.endsAt).getTime() > new Date(row.starts_at).getTime(),
      )) continue;
      remaining.push({
        resourceId,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        status: "locked",
        bookingOpensAt: null,
        bookedByName: row.display_name,
        occupationType: "tournament_final_day_program",
        displayColor: row.display_color,
        reservationAccess: null,
        resultDisplay: null,
        tournamentFinalRound: "final",
        hasReferee: false,
        refereeName: null,
      });
    }
    return remaining.sort((a, b) =>
      new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
    );
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
