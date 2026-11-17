import { supabase } from "@/infrastructure/supabase/client";

export type LiveBroadcasterPolicy =
  | "admin_only"
  | "participants"
  | "approval_required";

export type ClubLiveSettings = {
  clubId: string;
  youtubeChannelId: string;
  youtubeChannelLabel: string;
  broadcasterPolicy: LiveBroadcasterPolicy;
  allowReplays: boolean;
  connectionStatus: "awaiting_google_authorization";
  broadcastAvailable: false;
};

const mapSettings = (raw: unknown): ClubLiveSettings => {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    clubId: String(value.club_id ?? ""),
    youtubeChannelId: String(value.youtube_channel_id ?? ""),
    youtubeChannelLabel: String(value.youtube_channel_label ?? ""),
    broadcasterPolicy:
      value.broadcaster_policy === "participants" ||
      value.broadcaster_policy === "approval_required"
        ? value.broadcaster_policy
        : "admin_only",
    allowReplays: value.allow_replays !== false,
    connectionStatus: "awaiting_google_authorization",
    broadcastAvailable: false,
  };
};

export const adminLiveSettingsService = {
  async get(): Promise<ClubLiveSettings> {
    const { data, error } = await supabase.rpc("admin_get_club_live_settings");
    if (error) throw error;
    return mapSettings(data);
  },

  async save(settings: ClubLiveSettings): Promise<ClubLiveSettings> {
    const { data, error } = await supabase.rpc("admin_save_club_live_settings", {
      payload: {
        youtube_channel_id: settings.youtubeChannelId,
        youtube_channel_label: settings.youtubeChannelLabel,
        broadcaster_policy: settings.broadcasterPolicy,
        allow_replays: settings.allowReplays,
      },
    });
    if (error) throw error;
    return mapSettings(data);
  },
};
