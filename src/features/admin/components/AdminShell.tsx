import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import {
  Navigate,
  NavLink,
  Outlet,
  useLocation,
} from "react-router-dom";
import { adminNavigation } from "@/features/admin/config/adminPermissions";
import {
  AdminAccessProvider,
  useAdminAccess,
} from "@/features/admin/access/AdminAccessProvider";
import { ROUTES } from "@/shared/config";
import "./AdminShell.css";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `admin-shell__link${isActive ? " admin-shell__link--active" : ""}`;

const isEnabled = <T extends object>(item: T) =>
  !("enabled" in item) || item.enabled !== false;

export function AdminShell() {
  return (
    <AdminAccessProvider>
      <AdminShellContent />
    </AdminAccessProvider>
  );
}

function AdminShellContent() {
  const { access, error, hasPermission, isLoading } = useAdminAccess();
  const location = useLocation();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

  useEffect(() => {
    setMobileNavigationOpen(false);
  }, [location.pathname]);

  if (isLoading) return <p role="status">Chargement du Back Office…</p>;
  if (error)
    return (
      <section className="simple-page" role="alert">
        <h1>Accès indisponible</h1>
        <p>{error}</p>
      </section>
    );
  if (!access) return <Navigate to={ROUTES.forbidden} replace />;

  const visibleLinks = adminNavigation.flatMap((item) => {
    if (!isEnabled(item)) return [];
    if ("children" in item) {
      return item.children
        .filter(
          (child) => isEnabled(child) && hasPermission(child.permission),
        )
        .map((child) => ({ label: child.label, to: child.to }));
    }
    return hasPermission(item.permission)
      ? [{ label: item.label, to: item.to }]
      : [];
  });

  const currentLabel =
    visibleLinks
      .filter(
        (item) =>
          location.pathname === item.to ||
          (item.to !== ROUTES.admin &&
            location.pathname.startsWith(`${item.to}/`)),
      )
      .sort((first, second) => second.to.length - first.to.length)[0]?.label ??
    "Administration";

  return (
    <div className="admin-shell">
      <div className="admin-shell__mobile-bar">
        <div>
          <span>Administration</span>
          <strong>{currentLabel}</strong>
        </div>
        <button
          type="button"
          className="admin-shell__menu-toggle"
          aria-controls="admin-navigation"
          aria-expanded={mobileNavigationOpen}
          onClick={() => setMobileNavigationOpen((open) => !open)}
        >
          {mobileNavigationOpen ? (
            <X aria-hidden="true" />
          ) : (
            <Menu aria-hidden="true" />
          )}
          <span>{mobileNavigationOpen ? "Fermer" : "Menu"}</span>
        </button>
      </div>

      <aside
        id="admin-navigation"
        className={`admin-shell__sidebar${
          mobileNavigationOpen ? " admin-shell__sidebar--open" : ""
        }`}
      >
        <header>
          <span>Back Office</span>
          <strong>Administration</strong>
          <small>{access.clubName}</small>
        </header>
        <nav aria-label="Navigation de l’administration">
          {adminNavigation
            .filter(
              (item) =>
                isEnabled(item) &&
                ("children" in item
                  ? item.children.some(
                      (child) =>
                        isEnabled(child) && hasPermission(child.permission),
                    )
                  : hasPermission(item.permission)),
            )
            .map((item) =>
              "children" in item ? (
                <section key={item.label} className="admin-shell__group">
                  <p>{item.label}</p>
                  {item.children
                    .filter(
                      (child) =>
                        isEnabled(child) && hasPermission(child.permission),
                    )
                    .map((child) => (
                      <NavLink
                        key={child.to}
                        className={linkClass}
                        to={child.to}
                        onClick={() => setMobileNavigationOpen(false)}
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
                  onClick={() => setMobileNavigationOpen(false)}
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
