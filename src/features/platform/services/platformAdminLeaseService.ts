import { supabase } from "@/infrastructure/supabase/client";
import { platformSupabase } from "@/infrastructure/platform/platformClient";

export type PlatformAdminLease = {
  enabled: boolean;
  expiresAt?: string;
};

/**
 * The platform backend verifies both tokens before issuing a short-lived
 * business authorization. This client never grants permissions itself.
 */
export const platformAdminLeaseService = {
  async issue(): Promise<PlatformAdminLease> {
    const platform = platformSupabase;
    if (!platform) throw new Error("Session plateforme indisponible.");
    const [platformSession, businessSession] = await Promise.all([
      platform.auth.getSession(),
      supabase.auth.getSession(),
    ]);
    const platformToken = platformSession.data.session?.access_token;
    const businessToken = businessSession.data.session?.access_token;
    if (!platformToken || !businessToken) {
      throw new Error("Deux sessions authentifiées sont nécessaires.");
    }
    const { data, error } = await platform.functions.invoke(
      "platform-business-admin-lease",
      {
        method: "POST",
        headers: {
          "X-Business-Authorization": `Bearer ${businessToken}`,
        },
      },
    );
    if (error || data?.enabled !== true || typeof data.expiresAt !== "string") {
      throw new Error("Autorisation inter-clubs refusée.");
    }
    const expiresAt = Date.parse(data.expiresAt);
    const remainingMs = expiresAt - Date.now();
    if (
      !Number.isFinite(expiresAt) ||
      remainingMs <= 0 ||
      remainingMs > 15 * 60 * 1000
    ) {
      throw new Error("Autorisation inter-clubs expirée ou invalide.");
    }
    return { enabled: true, expiresAt: data.expiresAt };
  },

  async revoke(): Promise<void> {
    const platform = platformSupabase;
    if (!platform) return;
    const businessSession = await supabase.auth.getSession();
    const businessToken = businessSession.data.session?.access_token;
    if (!businessToken) return;
    const { data, error } = await platform.functions.invoke(
      "platform-business-admin-lease",
      {
        method: "DELETE",
        headers: {
          "X-Business-Authorization": `Bearer ${businessToken}`,
        },
      },
    );
    if (error || data?.revoked !== true) {
      throw new Error("Révocation inter-clubs non confirmée.");
    }
  },
};
