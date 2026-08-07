import { supabase } from "@/infrastructure/supabase/client";

export type TvSlotStatus = "available" | "reserved" | "unavailable";
export type TvWeekItemStatus = "reserved" | "unavailable";
export type TvDisplayStatus = "ready" | "disabled" | "invalid";

export type TvDisplaySlot = {
  startsAt: string;
  endsAt: string;
  status: TvSlotStatus;
  displayName: string | null;
};

export type TvDisplayResource = {
  id: string;
  name: string;
  slots: TvDisplaySlot[];
};

export type TvWeekItem = {
  resourceId: string;
  resourceName: string;
  startsAt: string;
  endsAt: string;
  status: TvWeekItemStatus;
  displayName: string;
};

export type TvWeekDay = {
  date: string;
  items: TvWeekItem[];
};

export type TvDisplay = {
  status: TvDisplayStatus;
  clubName: string | null;
  clubLogoUrl: string | null;
  displayDate: string | null;
  displayStartTime: string | null;
  displayEndTime: string | null;
  refreshIntervalSeconds: number;
  viewDurationSeconds: number;
  generatedAt: string | null;
  resources: TvDisplayResource[];
  weekStart: string | null;
  weekEnd: string | null;
  weekDays: TvWeekDay[];
};

const statuses = new Set<TvDisplayStatus>(["ready", "disabled", "invalid"]);
const slotStatuses = new Set<TvSlotStatus>([
  "available",
  "reserved",
  "unavailable",
]);
const weekItemStatuses = new Set<TvWeekItemStatus>(["reserved", "unavailable"]);

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const mapSlot = (value: unknown): TvDisplaySlot => {
  const row = asRecord(value);
  const status = String(row.status ?? "unavailable") as TvSlotStatus;

  return {
    startsAt: String(row.starts_at ?? ""),
    endsAt: String(row.ends_at ?? ""),
    status: slotStatuses.has(status) ? status : "unavailable",
    displayName:
      row.display_name === null || row.display_name === undefined
        ? null
        : String(row.display_name),
  };
};

const mapWeekItem = (value: unknown): TvWeekItem => {
  const row = asRecord(value);
  const status = String(row.status ?? "unavailable") as TvWeekItemStatus;

  return {
    resourceId: String(row.resource_id ?? ""),
    resourceName: String(row.resource_name ?? "Terrain"),
    startsAt: String(row.starts_at ?? ""),
    endsAt: String(row.ends_at ?? ""),
    status: weekItemStatuses.has(status) ? status : "unavailable",
    displayName: String(row.display_name ?? "Indisponible"),
  };
};

const clampViewDuration = (value: unknown) => {
  const seconds = Number(value ?? 60);
  if (!Number.isFinite(seconds)) return 60;
  return Math.min(300, Math.max(10, seconds));
};

const mapDisplay = (value: unknown, viewDurationSeconds: unknown): TvDisplay => {
  const row = asRecord(value);
  const status = String(row.status ?? "invalid") as TvDisplayStatus;
  const resources = Array.isArray(row.resources)
    ? (row.resources as Record<string, unknown>[])
    : [];
  const weekDays = Array.isArray(row.week_days)
    ? (row.week_days as Record<string, unknown>[])
    : [];

  return {
    status: statuses.has(status) ? status : "invalid",
    clubName: row.club_name ? String(row.club_name) : null,
    clubLogoUrl: row.club_logo_url ? String(row.club_logo_url) : null,
    displayDate: row.display_date ? String(row.display_date) : null,
    displayStartTime: row.display_start_time
      ? String(row.display_start_time)
      : null,
    displayEndTime: row.display_end_time ? String(row.display_end_time) : null,
    refreshIntervalSeconds: Math.max(
      15,
      Number(row.refresh_interval_seconds ?? 30),
    ),
    viewDurationSeconds: clampViewDuration(viewDurationSeconds),
    generatedAt: row.generated_at ? String(row.generated_at) : null,
    resources: resources.map((resource) => ({
      id: String(resource.id ?? ""),
      name: String(resource.name ?? "Terrain"),
      slots: Array.isArray(resource.slots) ? resource.slots.map(mapSlot) : [],
    })),
    weekStart: row.week_start ? String(row.week_start) : null,
    weekEnd: row.week_end ? String(row.week_end) : null,
    weekDays: weekDays.map((day) => ({
      date: String(day.date ?? ""),
      items: Array.isArray(day.items) ? day.items.map(mapWeekItem) : [],
    })),
  };
};

export const tvDisplayService = {
  async getDisplay(token: string): Promise<TvDisplay> {
    const [displayResult, durationResult] = await Promise.all([
      supabase.rpc("get_public_tv_display", {
        target_token: token,
      }),
      supabase.rpc("get_public_tv_view_duration", {
        target_token: token,
      }),
    ]);

    if (displayResult.error) throw displayResult.error;
    if (durationResult.error) throw durationResult.error;

    return mapDisplay(displayResult.data, durationResult.data);
  },
};
