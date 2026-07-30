import type { PropsWithChildren } from "react";
import { Navigate } from "react-router-dom";
import { ROUTES } from "@/shared/config";
import type { AdminPermission } from "@/features/admin/config/adminPermissions";
import { useAdminAccess } from "./AdminAccessProvider";

export function PermissionRoute({
  permission,
  children,
}: PropsWithChildren<{ permission: AdminPermission }>) {
  const { error, hasPermission, isLoading } = useAdminAccess();
  if (isLoading) return <p role="status">Chargement de vos habilitations…</p>;
  if (error || !hasPermission(permission))
    return <Navigate to={ROUTES.forbidden} replace />;
  return children;
}
