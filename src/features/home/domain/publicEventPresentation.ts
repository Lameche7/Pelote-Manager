const CLUB_TIME_ZONE = "Europe/Paris";

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: CLUB_TIME_ZONE,
});

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: CLUB_TIME_ZONE,
});

const clockFormatter = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: CLUB_TIME_ZONE,
});

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}

function formatClock(value: Date): string {
  const parts = clockFormatter.formatToParts(value);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";
  return `${hour}h${minute}`;
}

export function formatPublicEventPeriod(
  startsAt: string,
  endsAt: string,
): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "Date à confirmer";
  }

  const startDate = capitalize(dateFormatter.format(start));
  const endDate = capitalize(dateFormatter.format(end));
  const startClock = formatClock(start);
  const endClock = formatClock(end);

  if (dateKeyFormatter.format(start) === dateKeyFormatter.format(end)) {
    return `${startDate} · ${startClock}–${endClock}`;
  }

  return `${startDate} ${startClock} → ${endDate} ${endClock}`;
}
