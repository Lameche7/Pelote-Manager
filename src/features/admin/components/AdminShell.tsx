import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { adminNavigation } from "@/features/admin/config/adminPermissions";
import {
  AdminAccessProvider,
  useAdminAccess,
} from "@/features/admin/access/AdminAccessProvider";
import { ROUTES } from "@/shared/config";
import "./AdminShell.css";
import "./AdminMobileExperience.css";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `admin-shell__link${isActive ? " admin-shell__link--active" : ""}`;

const isEnabled = <T extends object>(item: T) =>
  !("enabled" in item) || item.enabled !== false;

export function AdminShell() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const requestedClubId = params.get("adminClubId") ?? "";
  const visualClubSlug = params.get("club");
  // Stop before mounting the legacy admin provider: visual selection is not
  // an authorized business context, and must not trigger legacy admin reads.
  if (visualClubSlug && !requestedClubId) {
    return (
      <section className="simple-page" role="status">
        <h1>Administration du club sélectionné indisponible</h1>
        <p>
          Le club du bandeau est un aperçu visuel. Ses données administratives
          ne sont pas encore accessibles.
        </p>
        <p>
          Revenez au club par défaut dans le sélecteur pour administrer votre
          club habituel.
        </p>
      </section>
    );
  }
  return (
    <AdminAccessProvider key={requestedClubId}>
      <AdminShellContent />
    </AdminAccessProvider>
  );
}

function AdminShellContent() {
  const { access, error, hasPermission, isLoading } = useAdminAccess();
  const location = useLocation();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const requestedClubId = new URLSearchParams(location.search).get(
    "adminClubId",
  );
  const visualClubSlug = new URLSearchParams(location.search).get("club");
  // Preserve the visual club selection; never infer authorization from it.
  const adminLink = (path: string) => {
    const params = new URLSearchParams();
    if (requestedClubId) params.set("adminClubId", requestedClubId);
    if (visualClubSlug) params.set("club", visualClubSlug);
    const query = params.toString();
    return query ? path + "?" + query : path;
  };

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

  // Explicit club selection remains read-only until the business RPCs and
  // platform lease are deployed and validated end-to-end. In particular,
  // never mount Outlet for a selected foreign club: other admin routes still
  // use implicit legacy club context.
  // Business RPCs are still based on the legacy implicit club context.
  // Never expose an admin screen for an explicit cross-club selection until
  // every business read/write is scoped and authorized by club ID server-side.
  if (requestedClubId) {
    return (
      <section className="simple-page" role="status">
        <h1>Administration inter-clubs en préparation</h1>
        <p>
          Le club {access.clubName} est identifié et vos droits sont vérifiés,
          mais ses données ne peuvent pas encore être administrées depuis cet
          espace.
        </p>
        <p>
          Les opérations restent désactivées jusqu’à validation de l’isolation
          des données.
        </p>
      </section>
    );
  }

  const visibleLinks: Array<{ label: string; to: string }> = [];
  adminNavigation.forEach((item) => {
    if (!isEnabled(item)) return;
    if ("children" in item) {
      item.children.forEach((child) => {
        if (isEnabled(child) && hasPermission(child.permission)) {
          visibleLinks.push({ label: child.label, to: child.to });
        }
      });
      return;
    }
    if (hasPermission(item.permission)) {
      visibleLinks.push({ label: item.label, to: item.to });
    }
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
                        to={adminLink(child.to)}
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
                  to={adminLink(item.to)}
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
