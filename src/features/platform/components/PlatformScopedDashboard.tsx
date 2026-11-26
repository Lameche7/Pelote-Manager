import { useEffect, useState } from "react";
import {
  adminDashboardService,
  type AdminDashboard,
} from "@/features/admin/services/adminDashboardService";
import type { ClubModules } from "@/features/admin/config/clubModules";
import "@/features/admin/pages/AdminDashboard.css";

export function PlatformScopedDashboard({
  clubId,
  clubName,
  modules,
}: {
  clubId: string;
  clubName: string;
  modules: ClubModules;
}) {
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    setDashboard(null);
    setError("");
    void adminDashboardService
      .getDashboardForClub(clubId)
      .then((data) => {
        if (active) setDashboard(data);
      })
      .catch(() => {
        if (active) setError("Tableau de bord du club indisponible.");
      });
    return () => {
      active = false;
    };
  }, [clubId, refresh]);

  const metrics = dashboard?.metrics;
  const cards = [
    {
      label: "Parties de tournoi jouées",
      value: metrics?.tournamentMatches,
      enabled: modules.tournaments,
    },
    {
      label: "Réservations du jour",
      value: metrics?.reservationsToday,
      enabled: modules.reservations,
    },
    {
      label: "Réservations sur 7 jours",
      value: metrics?.reservationsNext7Days,
      enabled: modules.reservations,
    },
    {
      label: "Parties de championnat jouées",
      value: metrics?.championshipMatches,
      enabled: modules.championships,
    },
    {
      label: "Licenciés actifs",
      value: metrics?.activeMembers,
      enabled: modules.licences,
    },
    {
      label: "Comptes rattachés",
      value: metrics?.linkedAccounts,
      enabled: modules.licences,
    },
    {
      label: "Alertes de paiement des réservations",
      value: metrics?.paymentAlerts,
      enabled: modules.payments && modules.reservations,
    },
    {
      label: "Messages actifs",
      value: metrics?.activeCommunications,
      enabled: modules.communication,
    },
  ].filter((card) => card.enabled);

  return (
    <section className="admin-page admin-dashboard">
      <header className="admin-page__header admin-dashboard__header">
        <div>
          <p className="admin-page__eyebrow">{clubName}</p>
          <h1>Tableau de bord</h1>
        </div>
        <button type="button" onClick={() => setRefresh((n) => n + 1)}>
          Actualiser
        </button>
      </header>
      {error ? (
        <p role="alert">{error}</p>
      ) : !dashboard ? (
        <p role="status">Chargement des indicateurs du club…</p>
      ) : (
        <div className="admin-dashboard__metrics">
          {cards.map((card) => (
            <article
              className="admin-card admin-dashboard__metric"
              key={card.label}
            >
              <span>{card.label}</span>
              <strong>{card.value}</strong>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
