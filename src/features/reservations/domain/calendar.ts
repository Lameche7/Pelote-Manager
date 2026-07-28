export type CalendarSlotStatus = "available" | "occupied" | "closed";

export type CalendarSlot = {
  resourceId: string;
  startsAt: string;
  endsAt: string;
  status: CalendarSlotStatus;
};

export type CalendarOccupation = {
  id: string;
  occupationType:
    | "reservation"
    | "match"
    | "closure"
    | "maintenance"
    | "club_event"
    | "animation";
  title: string;
  startsAt: string;
  endsAt: string;
};

export type ReservableResource = {
  id: string;
  name: string;
  description: string | null;
  timezone: string;
};

export function startOfIsoWeek(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  const day = result.getDay();
  const distanceFromMonday = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + distanceFromMonday);
  return result;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildWeekDays(anchorDate: Date): Date[] {
  const monday = startOfIsoWeek(anchorDate);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function groupSlotsByLocalDate(
  slots: CalendarSlot[],
  timezone: string,
): Map<string, CalendarSlot[]> {
  const formatter = new Intl.DateTimeFormat("fr-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const result = new Map<string, CalendarSlot[]>();

  for (const slot of slots) {
    const key = formatter.format(new Date(slot.startsAt));
    const daySlots = result.get(key) ?? [];
    daySlots.push(slot);
    result.set(key, daySlots);
  }

  return result;
}

export function formatTime(isoDate: string, timezone: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoDate));
}
