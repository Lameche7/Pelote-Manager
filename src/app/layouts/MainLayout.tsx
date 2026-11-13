import { useEffect, useState, type CSSProperties } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { RouteScrollReset } from "@/app/router/RouteScrollReset";
import { ExternalParticipationPrompt } from "@/features/auth/components/ExternalParticipationPrompt";
import {
  adminAccessService,
  type ClubAccess,
} from "@/features/admin/access/adminAccessService";
import { canAccessAdminDashboard } from "@/features/admin/access/adminAccessRules";
import {
  NOTIFICATIONS_CHANGED_EVENT,
  notificationService,
} from "@/features/notifications/services/notificationService";
import { clubBrandingService } from "@/features/home/services/clubBrandingService";
import { ClubLogo } from "@/shared/components/ClubLogo";
import { PlatformClubSwitcher } from "@/features/platform/components/PlatformClubSwitcher";
import { APP_CONFIG, CLUB_CONFIG, ROUTES } from "@/shared/config";
import { useAuth } from "@/shared/hooks/useAuth";
import "./MainLayout.css";

const navClassName = ({ isActive }: { isActive: boolean }) =>
  `app-navigation__link${isActive ? " app-navigation__link--active" : ""}`;

type ClubLayoutStyle = CSSProperties & {
  "--club-primary": string;
  "--club-secondary": string;
  "--club-accent": string;
  "--club-neutral": string;
};

export function MainLayout() {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const location = useLocation();
  const [branding, setBranding] = useState(() =>
    new URLSearchParams(window.location.search).has("club")
      ? clubBrandingService.unavailableFallback
      : clubBrandingService.fallback,
  );
  const [adminAccess, setAdminAccess] = useState<ClubAccess | null>(null);
  const clubSlug = new URLSearchParams(location.search).get("club")?.trim() || null;
  // Presentation context only: authorization is checked by business RPCs.
  const withClubPreview = (path: string) =>
    clubSlug ? `${path}${path.includes("?") ? "&" : "?"}club=${encodeURIComponent(clubSlug)}` : path;
  const layoutStyle: ClubLayoutStyle = {
    "--club-primary": branding.primaryColor,
    "--club-secondary": branding.secondaryColor,
    "--club-accent": branding.accentColor,
    "--club-neutral": branding.neutralColor,
  };

  useEffect(() => {
    let active = true;
    const reloadBranding = () => {
      // Never display Lourdes branding as a foreign club while loading or
      // after a failed foreign-club lookup.
      const safeFallback = clubSlug
        ? clubBrandingService.unavailableFallback
        : clubBrandingService.fallback;
      setBranding(safeFallback);
      void clubBrandingService.getPublicBranding(clubSlug).then((value) => {
        if (active) setBranding(value);
      }).catch(() => {
        if (active) setBranding(safeFallback);
      });
    };
    reloadBranding();
    window.addEventListener("club-branding-updated", reloadBranding);
    return () => {
      active = false;
      window.removeEventListener("club-branding-updated", reloadBranding);
    };
  }, [clubSlug]);
  const [isAdminAccessLoading, setIsAdminAccessLoading] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  useEffect(() => {
    document.title = `${APP_CONFIG.name} · ${branding.name}`;
    const description = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]',
    );
    description?.setAttribute(
      "content",
      `${APP_CONFIG.name}, l’espace de réservation de ${branding.name}.`,
    );
  }, [branding.name]);

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
    const requestedClubId = new URLSearchParams(location.search)
      .get("adminClubId")
      ?.trim();
    adminAccessService
      .listAuthorizedClubs()
      .then((accesses) => {
        if (!active) return;
        setAdminAccess(
          requestedClubId
            ? accesses.find((access) => access.clubId === requestedClubId) ?? null
            : accesses.length === 1
              ? accesses[0]
              : null,
        );
      })
      .catch(() => {
        if (active) {
          setAdminAccess(null);
        }
      })
      .finally(() => {
        if (active) setIsAdminAccessLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isAuthenticated, isLoading, user, location.search]);

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
    <div className="app-layout" style={layoutStyle}>
      <RouteScrollReset />
      <ExternalParticipationPrompt />
      <header className="app-header">
        <Link
          className="app-brand"
          to={withClubPreview(ROUTES.home)}
          aria-label={`${APP_CONFIG.name} - Accueil`}
        >
          <img
            className="app-brand__logo"
            src="/branding/pilotoki-wordmark.png"
            alt="PILOTOKI"
          />
          {new Date().getMonth() === 10 && (
            <img
              className="app-brand__movember-moustache"
              src="/branding/movember-moustache.svg"
              alt="Movember — sensibilisation à la santé masculine"
            />
          )}
          <span className="app-brand__club">
            <small>{branding.name}</small>
          </span>
        </Link>

        <PlatformClubSwitcher />
        <nav className="app-navigation" aria-label="Navigation principale">
          <NavLink className={navClassName} to={withClubPreview(ROUTES.home)}>
            Accueil
          </NavLink>
          <NavLink className={navClassName} to={withClubPreview(ROUTES.reservations)}>
            Réservations
          </NavLink>
          {!isLoading && isAuthenticated && (
            <NavLink className={navClassName} to={withClubPreview(ROUTES.userSpace)}>
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
              <NavLink
                className={navClassName}
                to={withClubPreview(`${ROUTES.admin}${new URLSearchParams(location.search).get("adminClubId") ? `?adminClubId=${encodeURIComponent(new URLSearchParams(location.search).get("adminClubId") ?? "")}` : ""}`)}
              >
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
                to={withClubPreview(ROUTES.login)}
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
            <strong>{branding.name}</strong>
            <span>
              {CLUB_CONFIG.foundedYear
                ? `Depuis ${CLUB_CONFIG.foundedYear} – ${CLUB_CONFIG.tagline}`
                : CLUB_CONFIG.tagline}
            </span>
          </div>
        </div>
        <div className="app-footer__meta">
          <small>
            © {new Date().getFullYear()} {APP_CONFIG.name}
          </small>
          <nav className="app-footer__legal" aria-label="Informations légales">
            <Link to={withClubPreview(ROUTES.legalNotice)}>Mentions légales</Link>
            <Link to={withClubPreview(ROUTES.privacy)}>Confidentialité</Link>
            <Link to={withClubPreview(ROUTES.terms)}>Conditions d’utilisation</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
