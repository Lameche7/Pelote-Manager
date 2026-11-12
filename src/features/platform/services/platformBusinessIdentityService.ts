import { supabase } from "@/infrastructure/supabase/client";
import { platformSupabase } from "@/infrastructure/platform/platformClient";

export type PlatformBusinessIdentity = {
  linked: boolean;
  businessUserId?: string;
  crossClubAdministrationEnabled: false;
};

/**
 * Read-only verification of two independent authenticated sessions.
 * Never use this result to authorize a business mutation.
 */
export async function verifyPlatformBusinessIdentity() {
  const denied: PlatformBusinessIdentity = {
    linked: false,
    crossClubAdministrationEnabled: false,
  };
  if (!platformSupabase) {
    return denied;
  }

  const sessions = await Promise.all([
    platformSupabase.auth.getSession(),
    supabase.auth.getSession(),
  ]);
  const platformSession = sessions[0].data;
  const businessSession = sessions[1].data;
  const platformToken = platformSession.session?.access_token;
  const businessToken = businessSession.session?.access_token;
  if (!platformToken || !businessToken) {
    return denied;
  }

  const { data, error } = await platformSupabase.functions.invoke(
    "platform-business-identity",
    {
      method: "POST",
      headers: {
        "X-Business-Authorization": `Bearer ${businessToken}`,
      },
    },
  );
  if (error || data?.linked !== true) {
    return denied;
  }

  const verified: PlatformBusinessIdentity = {
    linked: true,
    businessUserId:
      typeof data.businessUserId === "string"
        ? data.businessUserId
        : undefined,
    crossClubAdministrationEnabled: false,
  };
  return verified;
}
