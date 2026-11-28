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
import { usePublicCalendarMode } from "@/features/reservations/services/publicCalendarMode";
import { PlatformClubSwitcher } from "@/features/platform/components/PlatformClubSwitcher";
import { APP_CONFIG, ROUTES } from "@/shared/config";
import { useAuth } from "@/shared/hooks/useAuth";
import { supabase } from "@/infrastructure/supabase/client";
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
  const [adminAccess, setAdminAccess] = useState<{
    context: string;
    actor: string;
    access: ClubAccess;
  } | null>(null);
  const clubSlug =
    new URLSearchParams(location.search).get("club")?.trim() || null;
  const { mode: calendarMode } = usePublicCalendarMode(clubSlug);
  const withClubPreview = (path: string) =>
    clubSlug
      ? `${path}${path.includes("?") ? "&" : "?"}club=${encodeURIComponent(clubSlug)}`
      : path;
  const layoutStyle: ClubLayoutStyle = {
    "--club-primary": branding.primaryColor,
    "--club-secondary": branding.secondaryColor,
    "--club-accent": branding.accentColor,
    "--club-neutral": branding.neutralColor,
  };

  useEffect(() => {
    let active = true;
    const reloadBranding = () => {
      const safeFallback = clubSlug
        ? clubBrandingService.unavailableFallback
        : clubBrandingService.fallback;
      setBranding(safeFallback);
      void clubBrandingService
        .getPublicBranding(clubSlug)
        .then((value) => {
          if (active) setBranding(value);
        })
        .catch(() => {
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
      .then(async (accesses) => {
        if (!active) return;
        const candidates = requestedClubId
          ? accesses.filter((access) => access.clubId === requestedClubId)
          : accesses;
        if (candidates.length === 0) return;
        const current = await supabase.rpc("admin_current_club_id");
        if (!active || current.error || !current.data) return;
        const selected = candidates.find(
          (access) => access.clubId === current.data,
        );
        if (!selected) return;
        if (clubSlug) {
          const { data, error } = await supabase
            .from("clubs")
            .select("id,slug")
            .eq("id", selected.clubId)
            .single();
          if (!active || error || data?.slug !== clubSlug) return;
        }
        if (active) {
          setAdminAccess({
            context: location.search,
            actor: user.id,
            access: selected,
          });
        }
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
  }, [isAuthenticated, isLoading, user, location.search, clubSlug]);

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
          {(calendarMode === "reservations" || calendarMode === "planning") && (
            <NavLink
              className={navClassName}
              to={withClubPreview(ROUTES.reservations)}
            >
              {calendarMode === "planning" ? "Planning" : "Réservations"}
            </NavLink>
          )}
          {!isLoading && isAuthenticated && (
            <NavLink
              className={navClassName}
              to={withClubPreview(ROUTES.userSpace)}
            >
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
            adminAccess?.context === location.search &&
            adminAccess?.actor === user?.id &&
            canAccessAdminDashboard(adminAccess.access) && (
              <NavLink
                className={navClassName}
                to={withClubPreview(ROUTES.admin)}
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
          {branding.logoUrl && (
            <span className="club-logo club-logo--compact">
              <img src={branding.logoUrl} alt={branding.name} />
            </span>
          )}
          <div>
            <strong>{branding.name}</strong>
            <span>
              {[
                branding.foundedYear ? `Depuis ${branding.foundedYear}` : "",
                branding.tagline,
              ]
                .filter(Boolean)
                .join(" – ")}
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
