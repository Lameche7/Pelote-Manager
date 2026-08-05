import { Navigate, NavLink, Outlet } from "react-router-dom";
import { adminNavigation } from "@/features/admin/config/adminPermissions";
import {
  AdminAccessProvider,
  useAdminAccess,
} from "@/features/admin/access/AdminAccessProvider";
import { ROUTES } from "@/shared/config";
import "./AdminShell.css";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `admin-shell__link${isActive ? " admin-shell__link--active" : ""}`;

export function AdminShell() {
  return (
    <AdminAccessProvider>
      <AdminShellContent />
    </AdminAccessProvider>
  );
}

function AdminShellContent() {
  const { access, error, hasPermission, isLoading } = useAdminAccess();
  if (isLoading) return <p role="status">Chargement du Back Office…</p>;
  if (error)
    return (
      <section className="simple-page" role="alert">
        <h1>Accès indisponible</h1>
        <p>{error}</p>
      </section>
    );
  if (!access) return <Navigate to={ROUTES.forbidden} replace />;

  return (
    <div className="admin-shell">
      <aside className="admin-shell__sidebar">
        <header>
          <span>Back Office</span>
          <strong>Administration</strong>
          <small>{access.clubName}</small>
        </header>
        <nav aria-label="Navigation de l’administration">
          {adminNavigation
            .filter((item) =>
              "children" in item
                ? item.children.some((child) => hasPermission(child.permission))
                : hasPermission(item.permission),
            )
            .map((item) =>
              "children" in item ? (
                <section key={item.label} className="admin-shell__group">
                  <p>{item.label}</p>
                  {item.children
                    .filter((child) => hasPermission(child.permission))
                    .map((child) => (
                      <NavLink
                        key={child.to}
                        className={linkClass}
                        to={child.to}
                      >
                        {child.label}
                      </NavLink>
                    ))}
                </section>
              ) : (
                <NavLink
                  key={item.to}
                  className={linkClass}
                  to={item.to}
                  end={item.to === "/admin"}
                >
                  {item.label}
                </NavLink>
              ),
            )}
        </nav>
      </aside>
      <main className="admin-shell__content">
        <Outlet />
      </main>
    </div>
  );
}
