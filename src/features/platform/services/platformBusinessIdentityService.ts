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
export async function verifyPlatformBusinessIdentity(): Promise<PlatformBusinessIdentity> {
  if (!platformSupabase) {
    return { linked: false, crossClubAdministrationEnabled: false };
  }

  const [{ data: platformSession }, { data: businessSession }] =
    await Promise.all([platformSupabase.auth.getSession(), supabase.auth.getSession()]);
  const platformToken = platformSession.session?.access_token;
  const businessToken = businessSession.session?.access_token;
  if (!platformToken || !businessToken) {
    return { linked: false, crossClubAdministrationEnabled: false };
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
    return { linked: false, crossClubAdministrationEnabled: false };
  }

  return {
    linked: true,
    businessUserId:
      typeof data.businessUserId === "string"
        ? data.businessUserId
        : undefined,
    crossClubAdministrationEnabled: false,
  };
}
