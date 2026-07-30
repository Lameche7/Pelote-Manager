export type AccountType = "guest" | "account" | "licensee";
export type ReservationPeriod = "today" | "upcoming" | "history" | "all";

export type AdminReservationFilters = {
  search: string;
  resourceId: string;
  status: string;
  accountType: AccountType | "all";
  period: ReservationPeriod;
};

export const EMPTY_ADMIN_RESERVATION_FILTERS: AdminReservationFilters = {
  search: "",
  resourceId: "all",
  status: "all",
  accountType: "all",
  period: "today",
};

export function reservationRange(period: ReservationPeriod, now = new Date()) {
  if (period === "all") return { from: null, to: null };
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const tomorrow = new Date(start);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (period === "today")
    return { from: start.toISOString(), to: tomorrow.toISOString() };
  if (period === "upcoming") return { from: tomorrow.toISOString(), to: null };
  const recent = new Date(start);
  recent.setDate(recent.getDate() - 30);
  return { from: recent.toISOString(), to: start.toISOString() };
}

export function canManageReservation(status: string, accountType: AccountType) {
  return (
    accountType !== "guest" && (status === "pending" || status === "confirmed")
  );
}
