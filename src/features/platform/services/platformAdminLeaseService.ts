import { supabase } from "@/infrastructure/supabase/client";
import { platformSupabase } from "@/infrastructure/platform/platformClient";
import { verifyPlatformBusinessIdentity } from "./platformBusinessIdentityService";

export type PlatformAdminLease = {
  enabled: boolean;
  expiresAt?: string;
  remainingMs: number;
  receivedAt: number;
};

/**
 * The platform backend verifies both tokens before issuing a short-lived
 * business authorization. This client never grants permissions itself.
 */
export const platformAdminLeaseService = {
  async issue(clubId: string): Promise<PlatformAdminLease> {
    const platform = platformSupabase;
    if (!platform) throw new Error("Session plateforme indisponible.");
    const identity = await verifyPlatformBusinessIdentity();
    if (!identity.linked || !identity.businessUserId) {
      throw new Error("Identités plateforme et métier non vérifiées.");
    }
    const { data: allowed, error: roleError } =
      await platform.rpc("platform_is_admin");
    if (roleError || allowed !== true) {
      throw new Error("Super-administrateur requis.");
    }
    const [platformSession, businessSession] = await Promise.all([
      platform.auth.getSession(),
      supabase.auth.getSession(),
    ]);
    const platformToken = platformSession.data.session?.access_token;
    const businessToken = businessSession.data.session?.access_token;
    if (!platformToken || !businessToken) {
      throw new Error("Deux sessions authentifiées sont nécessaires.");
    }
    const startedAt = performance.now();
    const { data, error } = await platform.functions.invoke(
      "platform-business-admin-lease",
      {
        method: "POST",
        body: { clubId },
        headers: {
          "X-Business-Authorization": `Bearer ${businessToken}`,
        },
      },
    );
    if (error || data?.enabled !== true || typeof data.expiresAt !== "string") {
      throw new Error("Autorisation inter-clubs refusée.");
    }
    const expiresAt = Date.parse(data.expiresAt);
    const serverNow = Date.parse(data.serverNow ?? "");
    const receivedAt = performance.now();
    const remainingMs = expiresAt - serverNow - (receivedAt - startedAt);
    if (
      !Number.isFinite(expiresAt) ||
      !Number.isFinite(remainingMs) ||
      remainingMs <= 0 ||
      remainingMs > 5 * 60 * 1000
    ) {
      throw new Error("Autorisation inter-clubs expirée ou invalide.");
    }
    return {
      enabled: true,
      expiresAt: data.expiresAt,
      remainingMs,
      receivedAt,
    };
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
