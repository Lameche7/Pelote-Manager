import type { UserRole } from "@/shared/config";

export const accountTypeLabels: Record<UserRole, string> = {
  visitor: "Visiteur",
  user: "Visiteur",
  member: "Licencié",
  admin: "Administrateur",
};

export function getGreeting(firstName?: string) {
  const name = firstName?.trim();
  return name ? `Bonjour ${name} 👋` : "Bonjour !";
}
