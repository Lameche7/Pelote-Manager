import type { PropsWithChildren } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getProtectedRouteAccess } from "@/app/router/protectedRouteAccess";
import { ROUTES, type UserRole } from "@/shared/config";
import { useAuth } from "@/shared/hooks/useAuth";

type ProtectedRouteProps = PropsWithChildren<{
  allowedRoles?: readonly UserRole[];
}>;

export function ProtectedRoute({
  children,
  allowedRoles,
}: ProtectedRouteProps) {
  const { profile, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  const access = getProtectedRouteAccess({
    isLoading,
    isAuthenticated,
    role: profile?.role ?? null,
    ...(allowedRoles ? { allowedRoles } : {}),
  });

  if (access === "loading") {
    return <p role="status">Chargement de votre session…</p>;
  }

  if (access === "login") {
    return <Navigate to={ROUTES.login} replace state={{ from: location }} />;
  }

  if (access === "forbidden") {
    return <Navigate to={ROUTES.forbidden} replace />;
  }

  return children;
}
