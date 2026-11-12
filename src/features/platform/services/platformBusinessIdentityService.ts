import { supabase } from "@/infrastructure/supabase/client";
import { platformSupabase } from "@/infrastructure/platform/platformClient";

export type PlatformBusinessIdentity = {
  linked: boolean;
  businessUserId?: string;
  crossClubAdministrationEnabled: false;
};

const denied: PlatformBusinessIdentity = {
  linked: false,
  crossClubAdministrationEnabled: false,
};

/** Proof of matching sessions only; never a grant of business permissions. */
export async function verifyPlatformBusinessIdentity() {
  const client = platformSupabase;
  if (!client) return denied;

  const platformSession = await client.auth.getSession();
  const businessSession = await supabase.auth.getSession();
  const platformToken = platformSession.data.session?.access_token;
  const businessToken = businessSession.data.session?.access_token;
  if (!platformToken || !businessToken) return denied;

  const options = {
    method: "POST" as const,
    headers: {
      "X-Business-Authorization": `Bearer ${businessToken}`,
    },
  };
  const response = await client.functions.invoke(
    "platform-business-identity",
    options,
  );
  if (response.error || response.data?.linked !== true) return denied;

  const businessUserId = response.data.businessUserId;
  const verified: PlatformBusinessIdentity = {
    linked: true,
    businessUserId:
      typeof businessUserId === "string" ? businessUserId : undefined,
    crossClubAdministrationEnabled: false,
  };
  return verified;
}
