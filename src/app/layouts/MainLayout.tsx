import { Link, NavLink, Outlet } from "react-router-dom";
import { ClubLogo } from "@/shared/components/ClubLogo";
import { APP_CONFIG, ROUTES } from "@/shared/config";
import { useAuth } from "@/shared/hooks/useAuth";

const navClassName = ({ isActive }: { isActive: boolean }) =>
  `app-navigation__link${isActive ? " app-navigation__link--active" : ""}`;

export function MainLayout() {
  const { isAuthenticated, isLoading, logout } = useAuth();

  return (
    <div className="app-layout">
      <header className="app-header">
        <Link className="app-brand" to={ROUTES.home} aria-label="Pelote Manager - Accueil">
          <ClubLogo compact className="app-brand__logo" />
          <span>
            <strong>{APP_CONFIG.name}</strong>
            <small>Pelotaris Club Lourdais</small>
          </span>
        </Link>

        <nav className="app-navigation" aria-label="Navigation principale">
          <NavLink className={navClassName} to={ROUTES.home}>Accueil</NavLink>
          <NavLink className={navClassName} to={ROUTES.reservations}>Réservations</NavLink>
          {!isLoading && isAuthenticated && (
            <NavLink className={navClassName} to={ROUTES.userSpace}>Mon espace</NavLink>
          )}
          <NavLink className={navClassName} to={ROUTES.admin}>Administration</NavLink>
          {!isLoading &&
            (isAuthenticated ? (
              <button className="button button--small button--ghost" type="button" onClick={() => void logout()}>
                Se déconnecter
              </button>
            ) : (
              <Link className="button button--small button--primary" to={ROUTES.login}>Connexion</Link>
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
            <strong>Pelotaris Club Lourdais</strong>
            <span>Depuis 1957 – Plus qu’un Club, une Histoire.</span>
          </div>
        </div>
        <small>© {new Date().getFullYear()} {APP_CONFIG.name}</small>
      </footer>
    </div>
  );
}
