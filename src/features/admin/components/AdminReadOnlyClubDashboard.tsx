import { useEffect, useState } from "react";
import {
  adminDashboardService,
  type AdminDashboard,
} from "@/features/admin/services/adminDashboardService";

/**
 * Prepared for the explicit-club read-only route. This component must not be
 * mounted until scoped RPCs and short-lived platform leases are deployed.
 * No navigation or mutation actions are intentionally exposed.
 */
export function AdminReadOnlyClubDashboard({
  clubId,
  clubName,
}: {
  clubId: string;
  clubName: string;
}) {
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setDashboard(null);
    setError("");
    setLoading(true);
    void adminDashboardService
      .getDashboardForClub(clubId)
      .then((value) => {
        if (active) setDashboard(value);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Tableau de bord indisponible.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [clubId]);

  return (
    <section className="simple-page" aria-label="Tableau de bord du club">
      <h1>Tableau de bord · {clubName}</h1>
      <p>Consultation uniquement. Aucune opération administrative disponible.</p>
      {loading ? <p role="status">Chargement des données du club…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {!loading && !error && dashboard ? (
        <dl>
          <dt>Réservations du jour</dt>
          <dd>{dashboard.metrics.reservationsToday}</dd>
          <dt>Réservations sur 7 jours</dt>
          <dd>{dashboard.metrics.reservationsNext7Days}</dd>
          <dt>Parties de tournoi jouées</dt>
          <dd>{dashboard.metrics.tournamentMatches}</dd>
          <dt>Parties de championnat jouées</dt>
          <dd>{dashboard.metrics.championshipMatches}</dd>
        </dl>
      ) : null}
    </section>
  );
}
