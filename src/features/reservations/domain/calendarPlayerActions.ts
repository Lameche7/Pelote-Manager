/**
 * UI capabilities for an occupied calendar slot.
 *
 * Only pass a server-resolved match and authorization context here. Slot times,
 * display labels and local membership guesses are NOT authorization signals.
 * Every mutation must independently validate identity/authorization in its RPC.
 */
export type CalendarPlayerActionContext = {
  identityResolved: boolean;
  kind: "championship" | "tournament" | "reservation" | "other";
  isAuthenticated: boolean;
  isParticipant: boolean;
  isAssignedReferee: boolean;
  canVolunteerForRefereeing: boolean;
  hasResult: boolean;
  canSubmitResultNow: boolean;
  canRequestReport: boolean;
};

export type CalendarPlayerActions = {
  submitResult: boolean;
  volunteerReferee: boolean;
  requestReportInMySpace: boolean;
};

export function getCalendarPlayerActions(
  context: CalendarPlayerActionContext,
): CalendarPlayerActions {
  const empty = {
    submitResult: false,
    volunteerReferee: false,
    requestReportInMySpace: false,
  };
  if (
    !context.identityResolved ||
    !context.isAuthenticated ||
    (context.kind !== "championship" && context.kind !== "tournament")
  ) {
    return empty;
  }

  return {
    submitResult:
      (context.isParticipant || context.isAssignedReferee) &&
      !context.hasResult &&
      context.canSubmitResultNow,
    volunteerReferee:
      context.canVolunteerForRefereeing && !context.isAssignedReferee,
    requestReportInMySpace: context.isParticipant && context.canRequestReport,
  };
}
