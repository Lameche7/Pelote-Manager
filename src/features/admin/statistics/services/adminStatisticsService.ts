import { supabase } from "@/infrastructure/supabase/client";

export type StatisticsSummary = {
  totalReservations: number;
  validReservations: number;
  cancelledReservations: number;
  noShowReservations: number;
  cancellationRate: number;
  capacitySlots: number;
  occupiedSlots: number;
  occupancyRate: number;
  expectedRevenueCents: number;
  paidRevenueCents: number;
  refundedRevenueCents: number;
  licenseeReservations: number;
  accountReservations: number;
  guestReservations: number;
};

export type ResourceStatistics = {
  id: string;
  name: string;
  reservations: number;
  cancellations: number;
  capacitySlots: number;
  occupiedSlots: number;
  occupancyRate: number;
  expectedRevenueCents: number;
  paidRevenueCents: number;
};

export type DailyStatistics = {
  day: string;
  reservations: number;
  cancellations: number;
  expectedRevenueCents: number;
};

export type DistributionStatistics = {
  key: number;
  label: string;
  reservations: number;
};

export type PaymentStatistics = {
  status: string;
  count: number;
  amountCents: number;
};

export type ActiveSeason = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
};

export type ClubStatistics = {
  clubName: string;
  startDate: string;
  endDate: string;
  activeSeason: ActiveSeason | null;
  summary: StatisticsSummary;
  byResource: ResourceStatistics[];
  byDay: DailyStatistics[];
  byWeekday: DistributionStatistics[];
  byHour: DistributionStatistics[];
  paymentStatuses: PaymentStatistics[];
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const number = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const mapSummary = (value: unknown): StatisticsSummary => {
  const row = record(value);
  return {
    totalReservations: number(row.total_reservations),
    validReservations: number(row.valid_reservations),
    cancelledReservations: number(row.cancelled_reservations),
    noShowReservations: number(row.no_show_reservations),
    cancellationRate: number(row.cancellation_rate),
    capacitySlots: number(row.capacity_slots),
    occupiedSlots: number(row.occupied_slots),
    occupancyRate: number(row.occupancy_rate),
    expectedRevenueCents: number(row.expected_revenue_cents),
    paidRevenueCents: number(row.paid_revenue_cents),
    refundedRevenueCents: number(row.refunded_revenue_cents),
    licenseeReservations: number(row.licensee_reservations),
    accountReservations: number(row.account_reservations),
    guestReservations: number(row.guest_reservations),
  };
};

const mapActiveSeason = (value: unknown): ActiveSeason | null => {
  const row = record(value);
  const id = text(row.id);
  if (!id) return null;

  return {
    id,
    name: text(row.name),
    startsOn: text(row.starts_on),
    endsOn: text(row.ends_on),
  };
};

const mapStatistics = (value: unknown): ClubStatistics => {
  const payload = record(value);
  if (payload.status !== "ready") {
    throw new Error("Les statistiques du club sont momentanément indisponibles.");
  }

  return {
    clubName: text(payload.club_name),
    startDate: text(payload.start_date),
    endDate: text(payload.end_date),
    activeSeason: mapActiveSeason(payload.active_season),
    summary: mapSummary(payload.summary),
    byResource: list(payload.by_resource).map((value) => {
      const row = record(value);
      return {
        id: text(row.id),
        name: text(row.name),
        reservations: number(row.reservations),
        cancellations: number(row.cancellations),
        capacitySlots: number(row.capacity_slots),
        occupiedSlots: number(row.occupied_slots),
        occupancyRate: number(row.occupancy_rate),
        expectedRevenueCents: number(row.expected_revenue_cents),
        paidRevenueCents: number(row.paid_revenue_cents),
      };
    }),
    byDay: list(payload.by_day).map((value) => {
      const row = record(value);
      return {
        day: text(row.day),
        reservations: number(row.reservations),
        cancellations: number(row.cancellations),
        expectedRevenueCents: number(row.expected_revenue_cents),
      };
    }),
    byWeekday: list(payload.by_weekday).map((value) => {
      const row = record(value);
      return {
        key: number(row.weekday),
        label: text(row.label),
        reservations: number(row.reservations),
      };
    }),
    byHour: list(payload.by_hour).map((value) => {
      const row = record(value);
      return {
        key: number(row.hour),
        label: text(row.label),
        reservations: number(row.reservations),
      };
    }),
    paymentStatuses: list(payload.payment_statuses).map((value) => {
      const row = record(value);
      return {
        status: text(row.status),
        count: number(row.count),
        amountCents: number(row.amount_cents),
      };
    }),
  };
};

export const adminStatisticsService = {
  async getStatistics(startDate: string, endDate: string): Promise<ClubStatistics> {
    const { data, error } = await supabase.rpc("admin_get_club_statistics", {
      target_start_date: startDate,
      target_end_date: endDate,
    });

    if (error) throw error;
    return mapStatistics(data);
  },
};
