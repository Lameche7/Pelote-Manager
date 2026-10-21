/**
 * Identifies the actual business object behind a calendar occupation.
 *
 * Calendar coordinates are not business identifiers: a reschedule, exchange or
 * concurrent booking may change the occupation behind a time interval.
 * IDs must be provided by a trusted server-side resolver, never inferred
 * from titles, colours, or dates.
 */
export type CalendarOccupationIdentity =
  | { kind: "reservation"; reservationId: string; occupationId: string }
  | { kind: "championship"; matchId: string; occupationId: string }
  | { kind: "tournament"; matchId: string; occupationId: string }
  | { kind: "other"; occupationId: string };

/** Lightweight selection context used before resolving its business identity. */
export type CalendarSlotSelection = {
  resourceId: string;
  startsAt: string;
  endsAt: string;
};

/**
 * The client must not offer modifying actions until a server resolver has
 * established the identity and the server has separately checked permissions.
 */
export type ResolvedCalendarSelection =
  | { status: "unresolved"; slot: CalendarSlotSelection }
  | {
      status: "resolved";
      slot: CalendarSlotSelection;
      identity: CalendarOccupationIdentity;
    };

export function selectCalendarSlot(
  resourceId: string,
  startsAt: string,
  endsAt: string,
): ResolvedCalendarSelection {
  return {
    status: "unresolved",
    slot: { resourceId, startsAt, endsAt },
  };
}
