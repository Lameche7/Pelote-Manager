export const USER_ROLES = {
  visitor: "visitor",
  user: "user",
  member: "member",
  admin: "admin",
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

export function isUserRole(value: unknown): value is UserRole {
  return Object.values(USER_ROLES).some((role) => role === value);
}

export function parseUserRole(value: unknown): UserRole {
  if (isUserRole(value)) {
    return value;
  }

  throw new Error("Le profil contient un rôle utilisateur inconnu.");
}
