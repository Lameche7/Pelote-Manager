import { supabase } from "@/infrastructure/supabase/client";

export type TvModeResource = {
  id: string;
  name: string;
  selected: boolean;
  displayOrder: number | null;
};

export type TvModeSettings = {
  isEnabled: boolean;
  displayStartTime: string;
  displayEndTime: string;
  visibleSlotCount: number;
  refreshIntervalSeconds: number;
  viewDurationSeconds: number;
  publicToken: string;
  resources: TvModeResource[];
};

const mapSettings = (value: unknown): TvModeSettings => {
  const row = value as Record<string, unknown>;
  const resources = Array.isArray(row.resources)
    ? (row.resources as Record<string, unknown>[])
    : [];

  return {
    isEnabled: Boolean(row.is_enabled),
    displayStartTime: String(row.display_start_time ?? "08:00"),
    displayEndTime: String(row.display_end_time ?? "23:00"),
    visibleSlotCount: Number(row.visible_slot_count ?? 8),
    refreshIntervalSeconds: Number(row.refresh_interval_seconds ?? 30),
    viewDurationSeconds: Number(row.view_duration_seconds ?? 60),
    publicToken: String(row.public_token ?? ""),
    resources: resources.map((resource) => ({
      id: String(resource.id),
      name: String(resource.name),
      selected: Boolean(resource.selected),
      displayOrder:
        resource.display_order === null || resource.display_order === undefined
          ? null
          : Number(resource.display_order),
    })),
  };
};

export const adminTvSettingsService = {
  async getSettings(): Promise<TvModeSettings> {
    const { data, error } = await supabase.rpc("admin_get_tv_settings");
    if (error) throw error;
    return mapSettings(data);
  },

  async saveSettings(settings: TvModeSettings): Promise<void> {
    const { error } = await supabase.rpc("admin_save_tv_settings", {
      payload: {
        is_enabled: settings.isEnabled,
        display_start_time: settings.displayStartTime,
        display_end_time: settings.displayEndTime,
        visible_slot_count: settings.visibleSlotCount,
        refresh_interval_seconds: settings.refreshIntervalSeconds,
        view_duration_seconds: settings.viewDurationSeconds,
        resource_ids: settings.resources
          .filter((resource) => resource.selected)
          .map((resource) => resource.id),
      },
    });
    if (error) throw error;
  },

  async rotatePublicToken(): Promise<string> {
    const { data, error } = await supabase.rpc("admin_rotate_tv_token");
    if (error) throw error;
    return String(data);
  },
};
