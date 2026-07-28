import { USER_ROLES, type UserRole } from "@/shared/config";
import type { UserProfile } from "@/shared/types/profile";

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  [USER_ROLES.visitor]: "Visiteur",
  [USER_ROLES.user]: "Utilisateur",
  [USER_ROLES.member]: "Licencié",
  [USER_ROLES.admin]: "Administrateur",
};

export const USER_ROLE_OPTIONS = Object.values(USER_ROLES);

export function getProfileDisplayName(profile: UserProfile): string {
  return (
    profile.displayName ??
    [profile.firstName, profile.lastName].filter(Boolean).join(" ") ??
    profile.email
  ) || profile.email;
}

export function filterAdminProfiles(
  profiles: UserProfile[],
  search: string,
  role: UserRole | "all",
): UserProfile[] {
  const normalizedSearch = search.trim().toLocaleLowerCase("fr");

  return profiles.filter((profile) => {
    if (role !== "all" && profile.role !== role) {
      return false;
    }

    if (!normalizedSearch) {
      return true;
    }

    const searchable = [
      profile.email,
      profile.firstName,
      profile.lastName,
      profile.displayName,
      USER_ROLE_LABELS[profile.role],
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("fr");

    return searchable.includes(normalizedSearch);
  });
}
