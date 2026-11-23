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
  calendarSlot?: {
    resourceId: string;
    startsAt: string;
    endsAt: string;
  };
  scheduledStartTime: string;
  madeForKids: boolean;
  consentConfirmed: true;
};

export type ClubBroadcastSummary = {
  id: string;
  title: string;
  sourceType: "tournoi" | "championnat" | "other";
  sourceId: string | null;
  status: "scheduled" | "live" | "replay" | "hidden";
  createdAt: string;
  youtubeUrl: string;
};

export type UpstreamConnectionStatus = {
  configured: boolean;
  connected: boolean;
};

export type UpstreamStreamInfo = {
  id: string;
  name: string;
  status: string;
  type: string;
};

export type UpstreamStreamInventory = {
  configured: boolean;
  unavailable?: boolean;
  streams: UpstreamStreamInfo[];
};

export type UpstreamVideoBinding = {
  streamId: string;
  destinationConfigured?: boolean;
  alreadyLinked?: boolean;
};

export type UpstreamControlStatus = {
  safe: boolean;
  reason: string | null;
  streamStatus: string;
  destinationStatus: string;
  canStart: boolean;
  canStop: boolean;
};

export const adminLiveSettingsService = {
  async getUpstreamControlStatus(
    videoId: string,
  ): Promise<UpstreamControlStatus> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Reconnectez-vous à Pilotoki.");
    const response = await fetch(
      `/api/live-youtube-ingest?upstream=control&videoId=${encodeURIComponent(videoId)}`,
      { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
    );
    const dataResult = (await response.json()) as UpstreamControlStatus & {
      error?: string;
    };
    if (!response.ok)
      throw new Error(dataResult.error ?? "État Upstream indisponible.");
    return dataResult;
  },

  async controlUpstream(
    videoId: string,
    command: "start" | "stop",
  ): Promise<void> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Reconnectez-vous à Pilotoki.");
    const response = await fetch("/api/live-youtube-ingest", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "control_upstream",
        command,
        confirmed: true,
        videoId,
      }),
      cache: "no-store",
    });
    const dataResult = (await response.json()) as { error?: string };
    if (!response.ok)
      throw new Error(dataResult.error ?? "Commande Upstream impossible.");
  },

  async finishLivekitYoutube(videoId: string): Promise<void> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Reconnectez-vous à Pilotoki.");
    const response = await fetch("/api/live-youtube-ingest", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "livekit_youtube_finish",
        videoId,
        confirmed: true,
      }),
      cache: "no-store",
    });
    const result = (await response.json()) as {
      completed?: boolean;
      error?: string;
    };
    if (!response.ok || result.completed !== true)
      throw new Error(result.error ?? "YouTube n'a pas confirmé la fin du direct.");
  },

  async finishYoutubeLive(videoId: string): Promise<void> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Reconnectez-vous à Pilotoki.");
    const response = await fetch("/api/live-youtube-ingest", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "finish_youtube",
        videoId,
        confirmed: true,
      }),
      cache: "no-store",
    });
    const result = (await response.json()) as {
      completed?: boolean;
      error?: string;
    };
    if (!response.ok || result.completed !== true)
      throw new Error(result.error ?? "Fin du direct non confirmée.");
  },

  async reuseUpstreamForVideo(videoId: string): Promise<void> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Reconnectez-vous à Pilotoki.");
    const response = await fetch("/api/live-youtube-ingest", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "reuse_upstream",
        videoId,
        confirmed: true,
      }),
      cache: "no-store",
    });
    const result = (await response.json()) as {
      configured?: boolean;
      error?: string;
    };
    if (!response.ok || result.configured !== true)
      throw new Error(
        result.error ??
          "La régie précédente ne peut pas encore être réutilisée.",
      );
  },

  async publishYoutubeLive(videoId: string): Promise<{
    status: "live" | "liveStarting";
    alreadyLive: boolean;
  }> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Reconnectez-vous à Pilotoki.");
    const response = await fetch("/api/live-youtube-ingest", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "publish_youtube",
        videoId,
        confirmed: true,
      }),
      cache: "no-store",
    });
    const result = (await response.json()) as {
      status?: string;
      alreadyLive?: boolean;
      error?: string;
    };
    if (!response.ok)
      throw new Error(result.error ?? "Lancement YouTube impossible.");
    if (result.status !== "live" && result.status !== "liveStarting")
      throw new Error("YouTube n'a pas confirmé le lancement.");
    return {
      status: result.status,
      alreadyLive: result.alreadyLive === true,
    };
  },

  async getUpstreamBinding(
    videoId: string,
  ): Promise<UpstreamVideoBinding | null> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Reconnectez-vous à Pilotoki.");
    const response = await fetch(
      `/api/live-youtube-ingest?upstream=binding&videoId=${encodeURIComponent(videoId)}`,
      {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );
    const result = (await response.json()) as {
      binding?: UpstreamVideoBinding | null;
      error?: string;
    };
    if (!response.ok)
      throw new Error(result.error ?? "Liaison Upstream indisponible.");
    return result.binding ?? null;
  },

  async prepareUpstreamDestination(videoId: string): Promise<{
    configured: boolean;
    alreadyConfigured: boolean;
  }> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Reconnectez-vous à Pilotoki.");
    const response = await fetch("/api/live-youtube-ingest", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "prepare_upstream_destination",
        videoId,
        confirmed: true,
      }),
      cache: "no-store",
    });
    const result = (await response.json()) as {
      configured?: boolean;
      alreadyConfigured?: boolean;
      error?: string;
    };
    if (!response.ok || result.configured !== true)
      throw new Error(result.error ?? "Préparation Upstream impossible.");
    return {
      configured: true,
      alreadyConfigured: result.alreadyConfigured === true,
    };
  },

  async associateUpstreamStream(
    videoId: string,
    streamId: string,
  ): Promise<UpstreamVideoBinding> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Reconnectez-vous à Pilotoki.");
    const response = await fetch("/api/live-youtube-ingest", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "associate_upstream",
        videoId,
        streamId,
        confirmed: true,
      }),
      cache: "no-store",
    });
    const result = (await response.json()) as {
      binding?: UpstreamVideoBinding;
      error?: string;
    };
    if (!response.ok || !result.binding)
      throw new Error(result.error ?? "Association Upstream impossible.");
    return result.binding;
  },

  async listUpstreamStreams(): Promise<UpstreamStreamInventory> {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("Reconnectez-vous à Pilotoki.");
    const response = await fetch("/api/live-youtube-ingest?upstream=streams", {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const result = (await response.json()) as UpstreamStreamInventory & {
      error?: string;
    };
    if (!response.ok)
      throw new Error(result.error ?? "Inventaire Upstream indisponible.");
    return result;
  },

  async checkUpstreamConnection(): Promise<UpstreamConnectionStatus> {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("Reconnectez-vous à Pilotoki.");
    const response = await fetch("/api/live-youtube-ingest", {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const result = (await response.json()) as UpstreamConnectionStatus & {
      error?: string;
    };
    if (!response.ok)
      throw new Error(result.error ?? "Connexion Upstream indisponible.");
    return {
      configured: result.configured === true,
      connected: result.connected === true,
    };
  },
  async linkYoutubeIngest(videoId: string): Promise<string> {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("Reconnectez-vous à Pilotoki.");
    const response = await fetch("/api/live-youtube-ingest", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ videoId }),
      cache: "no-store",
    });
    const result = (await response.json()) as {
      status?: string;
      message?: string;
      error?: string;
    };
    if (!response.ok)
      throw new Error(result.error ?? "Impossible de lier le flux YouTube.");
    if (result.status !== "configured")
      throw new Error("Réponse inattendue du serveur vidéo.");
    return result.message ?? "Flux YouTube associé au direct.";
  },

  async listBroadcasts(): Promise<ClubBroadcastSummary[]> {
    const result = await this.refreshBroadcastStatuses();
    return result.videos;
  },

  async refreshBroadcastStatuses(): Promise<{
    videos: ClubBroadcastSummary[];
    syncWarning: boolean;
  }> {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("Reconnectez-vous à Pilotoki.");
    const response = await fetch("/api/live-youtube-prepare", {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const result = (await response.json()) as {
      videos?: ClubBroadcastSummary[];
      syncWarning?: boolean;
      error?: string;
    };
    if (!response.ok) throw new Error(result.error ?? "Directs indisponibles.");
    return {
      videos: result.videos ?? [],
      syncWarning: result.syncWarning === true,
    };
  },

  async prepareBroadcast(
    payload: PrepareBroadcastRequest,
  ): Promise<PreparedBroadcast> {
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
      throw new Error(
        result.error ?? "Impossible de préparer le direct YouTube.",
      );
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
