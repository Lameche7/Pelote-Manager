import type { UserRole } from "@/shared/config";

export type ProtectedRouteAccess = "loading" | "login" | "forbidden" | "allowed";

type ProtectedRouteAccessInput = {
  isLoading: boolean;
  isAuthenticated: boolean;
  role: UserRole | null;
  allowedRoles?: readonly UserRole[];
};

export function getProtectedRouteAccess({
  isLoading,
  isAuthenticated,
  role,
  allowedRoles,
}: ProtectedRouteAccessInput): ProtectedRouteAccess {
  if (isLoading) return "loading";
  if (!isAuthenticated) return "login";
  if (allowedRoles && (!role || !allowedRoles.includes(role))) {
    return "forbidden";
  }
  return "allowed";
}
