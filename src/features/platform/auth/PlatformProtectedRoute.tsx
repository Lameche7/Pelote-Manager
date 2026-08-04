import { Navigate, Outlet } from "react-router-dom";
import { ROUTES } from "@/shared/config";
import { usePlatformAuth } from "./usePlatformAuth";

export function PlatformProtectedRoute() {
  const { isConfigured, isAuthenticated, isAdmin, isLoading } =
    usePlatformAuth();

  if (!isConfigured) {
    return (
      <main className="platform-page platform-page--centered">
        <section className="platform-card">
          <p className="platform-kicker">Pelote Manager</p>
          <h1>Plateforme centrale non configurée</h1>
          <p>
            Ce déploiement reste une instance de club. La connexion centrale
            sera activée uniquement avec un projet Supabase de plateforme
            distinct.
          </p>
        </section>
      </main>
    );
  }

  if (isLoading) {
    return (
      <main className="platform-page platform-page--centered">
        <p>Vérification de l’accès super administrateur…</p>
      </main>
    );
  }

  if (!isAuthenticated || !isAdmin) {
    return <Navigate to={ROUTES.platformLogin} replace />;
  }

  return <Outlet />;
}
