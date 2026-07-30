const CLUB_TIME_ZONE = "Europe/Paris";

const formatter = new Intl.DateTimeFormat("fr-CA", {
  timeZone: CLUB_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function partsAt(date: Date): DateTimeParts {
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return parts as DateTimeParts;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Converts a stored timestamptz value to a wall-clock value for datetime-local. */
export function storedDateTimeToLocalInput(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new Error("Date d’évènement invalide.");
  const parts = partsAt(date);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** Converts a Europe/Paris datetime-local wall clock to an ISO timestamptz value. */
export function localInputToStoredDateTime(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Date et heure incomplètes.");
  const [, year, month, day, hour, minute] = match.map(Number);
  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wallClockUtc;
  // Two passes account for the offset change when the first estimate crosses DST.
  for (let pass = 0; pass < 2; pass += 1) {
    const local = partsAt(new Date(instant));
    const representedAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );
    instant = wallClockUtc - (representedAsUtc - instant);
  }
  const result = new Date(instant);
  const roundTrip = storedDateTimeToLocalInput(result.toISOString());
  if (roundTrip !== value) {
    throw new Error("Cette heure locale n’existe pas en Europe/Paris.");
  }
  return result.toISOString();
}
