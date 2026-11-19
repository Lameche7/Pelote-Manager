import { supabase } from "@/infrastructure/supabase/client";

export type LiveBroadcasterPolicy =
  "admin_only" | "participants" | "approval_required";

export type ClubLiveSettings = {
  clubId: string;
  youtubeChannelId: string;
  youtubeChannelLabel: string;
  broadcasterPolicy: LiveBroadcasterPolicy;
  allowReplays: boolean;
  connectionStatus: "awaiting_google_authorization" | "connected";
  canConnectGoogle: boolean;
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
    connectionStatus:
      value.connection_status === "connected"
        ? "connected"
        : "awaiting_google_authorization",
    canConnectGoogle: value.can_connect_google === true,
    broadcastAvailable: false,
  };
};

export type PreparedBroadcast = {
  youtubeUrl: string;
  title: string;
  scheduledStartTime: string;
  status: "scheduled";
  broadcastAvailable: false;
};

export type PrepareBroadcastRequest = {
  title: string;
  sourceType: "tournoi" | "championnat" | "other";
  sourceId: null;
  scheduledStartTime: string;
  madeForKids: boolean;
  consentConfirmed: true;
};

export const adminLiveSettingsService = {
  async prepareBroadcast(payload: PrepareBroadcastRequest): Promise<PreparedBroadcast> {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("Reconnectez-vous à Pilotoki.");
    const response = await fetch("/api/live-youtube-prepare", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const result = (await response.json()) as PreparedBroadcast & {
      error?: string;
    };
    if (!response.ok)
      throw new Error(result.error ?? "Impossible de préparer le direct YouTube.");
    if (!result.youtubeUrl?.startsWith("https://www.youtube.com/watch?v="))
      throw new Error("Réponse YouTube invalide.");
    return result;
  },

  async connectGoogle(): Promise<void> {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token)
      throw new Error("Reconnectez-vous à Pilotoki pour autoriser Google.");
    const response = await fetch("/api/live-google-connect", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      authorizationUrl?: string;
      error?: string;
    };
    if (
      !response.ok ||
      !payload.authorizationUrl?.startsWith("https://accounts.google.com/")
    ) {
      throw new Error(
        payload.error ?? "Impossible de démarrer la connexion Google.",
      );
    }
    window.location.assign(payload.authorizationUrl);
  },

  async get(): Promise<ClubLiveSettings> {
    const { data, error } = await supabase.rpc("admin_get_club_live_settings");
    if (error) throw error;
    return mapSettings(data);
  },

  async save(settings: ClubLiveSettings): Promise<ClubLiveSettings> {
    const { data, error } = await supabase.rpc(
      "admin_save_club_live_settings",
      {
        payload: {
          broadcaster_policy: settings.broadcasterPolicy,
          allow_replays: settings.allowReplays,
        },
      },
    );
    if (error) throw error;
    return mapSettings(data);
  },
};
