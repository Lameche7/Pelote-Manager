import { supabase } from "@/infrastructure/supabase/client";

export type TvSlotStatus = "available" | "reserved" | "unavailable";
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

export type TvDisplay = {
  status: TvDisplayStatus;
  clubName: string | null;
  clubLogoUrl: string | null;
  displayDate: string | null;
  displayStartTime: string | null;
  displayEndTime: string | null;
  refreshIntervalSeconds: number;
  generatedAt: string | null;
  resources: TvDisplayResource[];
};

const statuses = new Set<TvDisplayStatus>(["ready", "disabled", "invalid"]);
const slotStatuses = new Set<TvSlotStatus>([
  "available",
  "reserved",
  "unavailable",
]);

const mapSlot = (value: unknown): TvDisplaySlot => {
  const row = value as Record<string, unknown>;
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

const mapDisplay = (value: unknown): TvDisplay => {
  const row = (value ?? {}) as Record<string, unknown>;
  const status = String(row.status ?? "invalid") as TvDisplayStatus;
  const resources = Array.isArray(row.resources)
    ? (row.resources as Record<string, unknown>[])
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
    generatedAt: row.generated_at ? String(row.generated_at) : null,
    resources: resources.map((resource) => ({
      id: String(resource.id ?? ""),
      name: String(resource.name ?? "Terrain"),
      slots: Array.isArray(resource.slots) ? resource.slots.map(mapSlot) : [],
    })),
  };
};

export const tvDisplayService = {
  async getDisplay(token: string): Promise<TvDisplay> {
    const { data, error } = await supabase.rpc("get_public_tv_display", {
      target_token: token,
    });

    if (error) throw error;
    return mapDisplay(data);
  },
};
