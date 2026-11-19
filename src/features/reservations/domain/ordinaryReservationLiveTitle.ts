export type OrdinaryMatchLabels = {
  teamOne: string;
  teamTwo: string;
};

/** Titles for ordinary reservations, kept separate from tournament/championship metadata. */
export function ordinaryReservationLiveTitle(
  labels: OrdinaryMatchLabels,
  startsAt: string,
  timezone = "Europe/Paris",
): string {
  const date = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: timezone,
  }).format(new Date(startsAt));
  return `${labels.teamOne.trim()} vs ${labels.teamTwo.trim()} — ${date}`;
}
