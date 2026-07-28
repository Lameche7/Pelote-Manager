import { Link } from "react-router-dom";
import { ROUTES } from "@/shared/config";
import { useAuth } from "@/shared/hooks/useAuth";

export function AdminPage() {
  const { user, profile } = useAuth();

  return (
    <section className="simple-page" aria-labelledby="admin-title">
      <h1 id="admin-title">Administration</h1>
      <p>Cet espace d’administration est réservé aux administrateurs.</p>
      {user && <p>Adresse e-mail : {user.email}</p>}
      {profile?.displayName && <p>Nom d’affichage : {profile.displayName}</p>}
      {profile && <p>Rôle applicatif : {profile.role}</p>}
      <p>
        <Link to={ROUTES.adminUsers}>Gérer les utilisateurs et leurs rôles</Link>
      </p>
      <p>
        <Link to={ROUTES.adminReservations}>
          Configurer les réservations, horaires et fermetures
        </Link>
      </p>
      <p>
        <Link to={ROUTES.adminReservationOperations}>
          Suivre les réservations, statuts et statistiques
        </Link>
      </p>
      <p>
        <Link to={ROUTES.adminPayments}>Suivre les paiements HelloAsso</Link>
      </p>
    </section>
  );
}