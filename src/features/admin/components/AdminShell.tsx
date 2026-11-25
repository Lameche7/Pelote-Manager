import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  ADMIN_PERMISSIONS,
  adminNavigation,
} from "@/features/admin/config/adminPermissions";
import { AdminBlockedFinalsAlerts } from "@/features/admin/components/AdminBlockedFinalsAlerts";
import {
  AdminAccessProvider,
  useAdminAccess,
} from "@/features/admin/access/AdminAccessProvider";
import { ROUTES } from "@/shared/config";
import { supabase } from "@/infrastructure/supabase/client";
import {
  FULL_CLUB_MODULES,
  parseClubModules,
  type ClubModules,
} from "@/features/admin/config/clubModules";
import { isAdminRouteEnabled } from "@/features/admin/config/clubModuleNavigation";
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
  // Explicit business IDs still cannot mount legacy routes.
  if (requestedClubId) {
    return (
      <section className="simple-page" role="status">
        <h1>Administration inter-clubs en préparation</h1>
        <p>
          Les données du club sélectionné restent protégées tant que les
          autorisations métier ne sont pas déployées. Aucune donnée
          administrative ne sera chargée.
        </p>
      </section>
    );
  }
  return (
    <AdminAccessProvider key={requestedClubId}>
      <AdminShellContent key={params.get("club") ?? ""} />
    </AdminAccessProvider>
  );
}

function AdminShellContent() {
  const { access, error, isLoading } = useAdminAccess();
  const location = useLocation();
  const requestedClubId = new URLSearchParams(location.search).get(
    "adminClubId",
  );

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

  return (
    <VerifiedLocalClub
      key={access.clubId}
      clubId={access.clubId}
      clubName={access.clubName}
    />
  );
}

function VerifiedLocalClub({
  clubId,
  clubName,
}: {
  clubId: string;
  clubName: string;
}) {
  const location = useLocation();
  const visualClubSlug = new URLSearchParams(location.search).get("club");
  const [verified, setVerified] = useState<boolean | null>(null);

  useEffect(() => {
    if (!visualClubSlug) return;
    let active = true;
    void (async () => {
      try {
        const current = await supabase.rpc("admin_current_club_id");
        if (current.error || current.data !== clubId) {
          if (active) setVerified(false);
          return;
        }
        const { data, error } = await supabase
          .from("clubs")
          .select("id,slug")
          .eq("id", clubId)
          .single();
        const matches =
          !error && data?.id === clubId && data.slug === visualClubSlug;
        if (active) setVerified(matches);
      } catch {
        if (active) setVerified(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [clubId, visualClubSlug]);

  if (visualClubSlug && verified === null)
    return <p role="status">Vérification du club sélectionné…</p>;
  if (visualClubSlug && !verified)
    return (
      <section className="simple-page" role="status">
        <h1>Administration inter-clubs en préparation</h1>
        <p>
          Ce club ne correspond pas à votre habilitation métier locale. Aucune
          donnée administrative ne sera chargée.
        </p>
      </section>
    );

  return (
    <ClubAdminNavigation key={clubId} clubId={clubId} clubName={clubName} />
  );
}

function ClubAdminNavigation({
  clubId,
  clubName,
}: {
  clubId: string;
  clubName: string;
}) {
  const { hasPermission } = useAdminAccess();
  const location = useLocation();
  const requestedClubId = new URLSearchParams(location.search).get(
    "adminClubId",
  );
  const visualClubSlug = new URLSearchParams(location.search).get("club");
  const adminLink = (path: string) => {
    const params = new URLSearchParams();
    if (visualClubSlug) params.set("club", visualClubSlug);
    if (requestedClubId) params.set("adminClubId", requestedClubId);
    const query = params.toString();
    return query ? `${path}?${query}` : path;
  };
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [modules, setModules] = useState<ClubModules | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error } = await supabase.rpc("admin_get_club_modules", {
          target_club_id: clubId,
        });
        if (error) throw error;
        const profile = parseClubModules(data ?? FULL_CLUB_MODULES);
        if (!profile) throw new Error("Invalid module profile");
        if (active) setModules(profile);
      } catch {
        if (active) setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [clubId]);
  useEffect(() => {
    setMobileNavigationOpen(false);
  }, [location.pathname]);
  if (failed)
    return <p role="alert">Configuration des fonctionnalités indisponible.</p>;
  if (!modules)
    return <p role="status">Chargement des fonctionnalités du club…</p>;
  const routeEnabled = (path: string) => isAdminRouteEnabled(path, modules);
  const visibleLinks: Array<{ label: string; to: string }> = [];
  adminNavigation.forEach((item) => {
    if (!isEnabled(item)) return;
    if ("children" in item) {
      item.children.forEach((child) => {
        if (
          isEnabled(child) &&
          hasPermission(child.permission) &&
          routeEnabled(child.to)
        ) {
          visibleLinks.push({ label: child.label, to: child.to });
        }
      });
      return;
    }
    if (hasPermission(item.permission) && routeEnabled(item.to)) {
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
          <small>{clubName}</small>
        </header>
        <nav aria-label="Navigation de l’administration">
          {adminNavigation
            .filter(
              (item) =>
                isEnabled(item) &&
                ("children" in item
                  ? item.children.some(
                      (child) =>
                        isEnabled(child) &&
                        hasPermission(child.permission) &&
                        routeEnabled(child.to),
                    )
                  : hasPermission(item.permission) && routeEnabled(item.to)),
            )
            .map((item) =>
              "children" in item ? (
                <section key={item.label} className="admin-shell__group">
                  <p>{item.label}</p>
                  {item.children
                    .filter(
                      (child) =>
                        isEnabled(child) &&
                        hasPermission(child.permission) &&
                        routeEnabled(child.to),
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
        {modules.tournaments &&
          hasPermission(ADMIN_PERMISSIONS.tournaments) && (
            <AdminBlockedFinalsAlerts />
          )}
        {routeEnabled(location.pathname) ? (
          <Outlet />
        ) : (
          <p role="alert">
            Cette fonctionnalité n’est pas activée pour ce club.
          </p>
        )}
      </main>
    </div>
  );
}
