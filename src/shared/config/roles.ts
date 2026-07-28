export const USER_ROLES = {
  visitor: "visitor",
  user: "user",
  member: "member",
  admin: "admin",
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];
