import type { AuthUser } from "../../../shared/types/auth.js";
import type { UserProfile } from "../../../shared/types/profile.js";

/**
 * Finalizes every authenticated account through the shared profile creation path.
 * When an email-confirmed member registration opens a session directly, finish
 * the pending licence link here instead of requiring another manual login.
 */
export async function finalizeAccountProfile(
  user: AuthUser,
  getOrCreateProfile: (user: AuthUser) => Promise<UserProfile>,
  finalizePendingMemberRegistration: () => Promise<boolean> = async () => false,
): Promise<UserProfile> {
  let currentProfile = await getOrCreateProfile(user);

  if (currentProfile.memberId) return currentProfile;

  const memberRegistrationFinalized =
    await finalizePendingMemberRegistration();
  if (!memberRegistrationFinalized) return currentProfile;

  currentProfile = await getOrCreateProfile(user);
  return currentProfile;
}
