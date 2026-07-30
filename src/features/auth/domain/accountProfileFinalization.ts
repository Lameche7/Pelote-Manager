import type { AuthUser } from "../../../shared/types/auth.js";
import type { UserProfile } from "../../../shared/types/profile.js";

/**
 * Finalizes every authenticated account through the shared profile creation path.
 * This also covers visitor accounts whose Supabase session only exists after
 * email confirmation and their first login.
 */
export async function finalizeAccountProfile(
  user: AuthUser,
  getOrCreateProfile: (user: AuthUser) => Promise<UserProfile>,
): Promise<UserProfile> {
  return getOrCreateProfile(user);
}
