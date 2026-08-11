export type PlanningCalendarWeek = {
  start: string;
  end: string;
  days: string[];
};

const parseIsoDate = (value: string) => new Date(`${value}T12:00:00`);

export const toIsoDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const addDaysIso = (value: string, amount: number) => {
  const date = parseIsoDate(value);
  date.setDate(date.getDate() + amount);
  return toIsoDate(date);
};

export const startOfWeekIso = (value: string) => {
  const date = parseIsoDate(value);
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + offset);
  return toIsoDate(date);
};

export const buildWeekDays = (value: string) => {
  const start = startOfWeekIso(value);
  return Array.from({ length: 7 }, (_, index) => addDaysIso(start, index));
};

export const firstDayOfMonthIso = (value: string) => {
  const date = parseIsoDate(value);
  date.setDate(1);
  return toIsoDate(date);
};

export const shiftMonthIso = (value: string, amount: number) => {
  const date = parseIsoDate(firstDayOfMonthIso(value));
  date.setMonth(date.getMonth() + amount);
  return toIsoDate(date);
};

export const buildMonthGridDays = (value: string) => {
  const monthStart = firstDayOfMonthIso(value);
  const date = parseIsoDate(monthStart);
  date.setMonth(date.getMonth() + 1);
  date.setDate(0);
  const monthEnd = toIsoDate(date);
  const gridStart = startOfWeekIso(monthStart);
  const gridEnd = addDaysIso(startOfWeekIso(monthEnd), 6);
  const days: string[] = [];

  for (let current = gridStart; current <= gridEnd; current = addDaysIso(current, 1)) {
    days.push(current);
  }

  return days;
};

export const buildTournamentWeeks = (
  startsOn: string,
  endsOn: string,
): PlanningCalendarWeek[] => {
  if (!startsOn || !endsOn || endsOn < startsOn) return [];

  const weeks: PlanningCalendarWeek[] = [];
  const firstWeek = startOfWeekIso(startsOn);
  const lastWeek = startOfWeekIso(endsOn);

  for (
    let current = firstWeek;
    current <= lastWeek;
    current = addDaysIso(current, 7)
  ) {
    weeks.push({
      start: current,
      end: addDaysIso(current, 6),
      days: buildWeekDays(current),
    });
  }

  return weeks;
};

export const isIsoDateBetween = (
  value: string,
  startsOn: string,
  endsOn: string,
) => value >= startsOn && value <= endsOn;
