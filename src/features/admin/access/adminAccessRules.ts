export const ADMIN_DASHBOARD_PERMISSION = "admin.dashboard.read";

type PermissionAccess = {
  permissions: readonly string[];
};

export function canAccessAdminDashboard(
  access: PermissionAccess | null,
): boolean {
  return access?.permissions.includes(ADMIN_DASHBOARD_PERMISSION) ?? false;
}
