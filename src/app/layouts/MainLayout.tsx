import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import {
  adminAccessService,
  type ClubAccess,
} from "@/features/admin/access/adminAccessService";
import { canAccessAdminDashboard } from "@/features/admin/access/adminAccessRules";
import {
  NOTIFICATIONS_CHANGED_EVENT,
  notificationService,
} from "@/features/notifications/services/notificationService";
import { ClubLogo } from "@/shared/components/ClubLogo";
import { APP_CONFIG, CLUB_CONFIG, ROUTES } from "@/shared/config";
import { useAuth } from "@/shared/hooks/useAuth";
import "./MainLayout.css";

const navClassName = ({ isActive }: { isActive: boolean }) =>
  `app-navigation__link${isActive ? " app-navigation__link--active" : ""}`;

export function MainLayout() {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const [adminAccess, setAdminAccess] = useState<ClubAccess | null>(null);
  const [isAdminAccessLoading, setIsAdminAccessLoading] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  useEffect(() => {
    document.title = `${APP_CONFIG.name} · ${CLUB_CONFIG.name}`;
    const description = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]',
    );
    description?.setAttribute(
      "content",
      `${APP_CONFIG.name}, l’espace de réservation de ${CLUB_CONFIG.name}.`,
    );
  }, []);

  useEffect(() => {
    let active = true;

    if (isLoading || !isAuthenticated || !user) {
      setAdminAccess(null);
      setIsAdminAccessLoading(false);
      return () => {
        active = false;
      };
    }

    setAdminAccess(null);
    setIsAdminAccessLoading(true);
    adminAccessService
      .getOptionalAccess()
      .then((access) => {
        if (active) setAdminAccess(access);
      })
      .catch(() => {
        if (active) setAdminAccess(null);
      })
      .finally(() => {
        if (active) setIsAdminAccessLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isAuthenticated, isLoading, user]);

  useEffect(() => {
    let active = true;

    const loadUnread = () => {
      if (isLoading || !isAuthenticated || !user) {
        setUnreadNotifications(0);
        return;
      }

      notificationService
        .countUnread()
        .then((count) => {
          if (active) setUnreadNotifications(count);
        })
        .catch(() => {
          if (active) setUnreadNotifications(0);
        });
    };

    loadUnread();
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, loadUnread);

    return () => {
      active = false;
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, loadUnread);
    };
  }, [isAuthenticated, isLoading, user]);

  return (
    <div className="app-layout">
      <header className="app-header">
        <Link
          className="app-brand"
          to={ROUTES.home}
          aria-label={`${APP_CONFIG.name} - Accueil`}
        >
          <ClubLogo compact className="app-brand__logo" />
          <span>
            <strong>{APP_CONFIG.name}</strong>
            <small>{CLUB_CONFIG.name}</small>
          </span>
        </Link>

        <nav className="app-navigation" aria-label="Navigation principale">
          <NavLink className={navClassName} to={ROUTES.home}>
            Accueil
          </NavLink>
          <NavLink className={navClassName} to={ROUTES.reservations}>
            Réservations
          </NavLink>
          {!isLoading && isAuthenticated && (
            <NavLink className={navClassName} to={ROUTES.userSpace}>
              Mon espace
              {unreadNotifications > 0 && (
                <span
                  className="app-navigation__badge"
                  aria-label={`${unreadNotifications} notification${unreadNotifications > 1 ? "s" : ""} non lue${unreadNotifications > 1 ? "s" : ""}`}
                >
                  {unreadNotifications > 99 ? "99+" : unreadNotifications}
                </span>
              )}
            </NavLink>
          )}
          {!isLoading &&
            !isAdminAccessLoading &&
            canAccessAdminDashboard(adminAccess) && (
              <NavLink className={navClassName} to={ROUTES.admin}>
                Administration
              </NavLink>
            )}
          {!isLoading &&
            (isAuthenticated ? (
              <button
                className="button button--small button--ghost"
                type="button"
                onClick={() => void logout()}
              >
                Se déconnecter
              </button>
            ) : (
              <Link
                className="button button--small button--primary"
                to={ROUTES.login}
              >
                Connexion
              </Link>
            ))}
        </nav>
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      <footer className="app-footer">
        <div className="app-footer__brand">
          <ClubLogo compact />
          <div>
            <strong>{CLUB_CONFIG.name}</strong>
            <span>
              {CLUB_CONFIG.foundedYear
                ? `Depuis ${CLUB_CONFIG.foundedYear} – ${CLUB_CONFIG.tagline}`
                : CLUB_CONFIG.tagline}
            </span>
          </div>
        </div>
        <small>
          © {new Date().getFullYear()} {APP_CONFIG.name}
        </small>
      </footer>
    </div>
  );
}
