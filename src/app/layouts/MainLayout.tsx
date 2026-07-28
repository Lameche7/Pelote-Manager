import { Link, Outlet } from "react-router-dom";
import { APP_CONFIG, ROUTES } from "@/shared/config";
import { useAuth } from "@/shared/hooks/useAuth";

export function MainLayout() {
  const { isAuthenticated, isLoading, logout } = useAuth();

  return (
    <div className="app-layout">
      <header className="app-header">
        <span className="app-header__name">{APP_CONFIG.name}</span>
        <nav className="app-navigation" aria-label="Navigation principale">
          <Link to={ROUTES.home}>Accueil</Link>
          <Link to={ROUTES.reservations}>Réservations</Link>
          <Link to={ROUTES.admin}>Administration</Link>
          {!isLoading &&
            (isAuthenticated ? (
              <button type="button" onClick={() => void logout()}>
                Se déconnecter
              </button>
            ) : (
              <Link to={ROUTES.login}>Connexion</Link>
            ))}
        </nav>
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      <footer className="app-footer">
        <small>
          © {new Date().getFullYear()} {APP_CONFIG.name}
        </small>
      </footer>
    </div>
  );
}
