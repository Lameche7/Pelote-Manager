import type { PropsWithChildren } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ROUTES, type UserRole } from "@/shared/config";
import { useAuth } from "@/shared/hooks/useAuth";

type ProtectedRouteProps = PropsWithChildren<{
  allowedRoles?: readonly UserRole[];
}>;

export function ProtectedRoute({
  children,
  allowedRoles,
}: ProtectedRouteProps) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <p role="status">Chargement de votre session…</p>;
  }

  if (!isAuthenticated) {
    return <Navigate to={ROUTES.login} replace state={{ from: location }} />;
  }

  if (allowedRoles && (!user || !allowedRoles.includes(user.role))) {
    return <Navigate to={ROUTES.forbidden} replace />;
  }

  return children;
}
