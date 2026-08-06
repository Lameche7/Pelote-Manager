import { supabase } from "@/infrastructure/supabase/client";

export type StatisticsSummary = {
  reservations: number;
  cancelled: number;
  licensees: number;
  visitors: number;
  revenueCents: number;
  occupiedHours: number;
};

export type StatisticsBreakdown = {
  label: string;
  value: number;
  secondaryValue?: number;
};

export type ClubStatistics = {
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  summary: StatisticsSummary;
  byResource: StatisticsBreakdown[];
  byWeekday: StatisticsBreakdown[];
  byHour: StatisticsBreakdown[];
};

type RawStatistics = {
  period_start?: unknown;
  period_end?: unknown;
  generated_at?: unknown;
  summary?: Record<string, unknown>;
  by_resource?: Array<Record<string, unknown>>;
  by_weekday?: Array<Record<string, unknown>>;
  by_hour?: Array<Record<string, unknown>>;
};

const numberValue = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const weekdays = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

export const statisticsAdminService = {
  async getStatistics(periodStart: string, periodEnd: string): Promise<ClubStatistics> {
    const { data, error } = await supabase.rpc("admin_get_club_statistics", {
      period_start: periodStart,
      period_end: periodEnd,
    });
    if (error) throw error;

    const raw = (data ?? {}) as RawStatistics;
    const summary = raw.summary ?? {};

    return {
      periodStart: String(raw.period_start ?? periodStart),
      periodEnd: String(raw.period_end ?? periodEnd),
      generatedAt: String(raw.generated_at ?? new Date().toISOString()),
      summary: {
        reservations: numberValue(summary.reservations),
        cancelled: numberValue(summary.cancelled),
        licensees: numberValue(summary.licensees),
        visitors: numberValue(summary.visitors),
        revenueCents: numberValue(summary.revenue_cents),
        occupiedHours: numberValue(summary.occupied_hours),
      },
      byResource: (raw.by_resource ?? []).map((row) => ({
        label: String(row.resource_name ?? "Terrain"),
        value: numberValue(row.reservations),
        secondaryValue: numberValue(row.hours),
      })),
      byWeekday: (raw.by_weekday ?? []).map((row) => ({
        label: weekdays[numberValue(row.weekday)] ?? `Jour ${row.weekday}`,
        value: numberValue(row.reservations),
      })),
      byHour: (raw.by_hour ?? []).map((row) => ({
        label: `${String(numberValue(row.hour)).padStart(2, "0")}h`,
        value: numberValue(row.reservations),
      })),
    };
  },
};
