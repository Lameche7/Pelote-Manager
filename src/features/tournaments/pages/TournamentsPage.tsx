import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { tournamentService } from "@/features/tournaments/services/tournamentService";
import type { PublicTournamentSummary } from "@/features/tournaments/types";
import { ROUTES } from "@/shared/config";
import "./TournamentsPage.css";

const statusLabels: Record<string, string> = {
  registrations_open: "Inscriptions ouvertes",
  registrations_closed: "Inscriptions fermées",
  pools_generated: "Poules générées",
  pools_validated: "Poules validées",
  planning_generated: "Planning généré",
  planning_published: "Planning publié",
  in_progress: "En cours",
  completed: "Terminé",
  archived: "Archivé",
};

const formatDate = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

export function TournamentsPage() {
  const [tournaments, setTournaments] = useState<PublicTournamentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    tournamentService
      .listPublic()
      .then((items) => {
        if (active) setTournaments(items);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Impossible de charger les tournois.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="public-tournaments">
      <header className="public-tournaments__hero">
        <p>Compétitions du club</p>
        <h1>Tournois</h1>
        <span>
          Consultez les séries, les équipes inscrites et les informations de
          chaque tournoi.
        </span>
      </header>

      {loading && <p role="status">Chargement des tournois…</p>}
      {error && (
        <p className="public-tournaments__error" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && tournaments.length === 0 && (
        <div className="public-tournaments__empty">
          <h2>Aucun tournoi publié pour le moment</h2>
          <p>
            Les prochains tournois apparaîtront ici dès l’ouverture des
            inscriptions.
          </p>
        </div>
      )}

      <div className="public-tournaments__grid">
        {tournaments.map((tournament) => (
          <article className="public-tournament-card" key={tournament.id}>
            <div className="public-tournament-card__topline">
              <span
                className={`public-tournament-status public-tournament-status--${tournament.status}`}
              >
                {statusLabels[tournament.status] ?? tournament.status}
              </span>
              <strong>
                {tournament.teamCount} équipe
                {tournament.teamCount > 1 ? "s" : ""}
              </strong>
            </div>
            <h2>{tournament.name}</h2>
            {tournament.description && <p>{tournament.description}</p>}
            <dl>
              <div>
                <dt>Tournoi</dt>
                <dd>
                  {formatDate(tournament.startsOn)} →{" "}
                  {formatDate(tournament.endsOn)}
                </dd>
              </div>
              <div>
                <dt>Séries</dt>
                <dd>{tournament.series.length}</dd>
              </div>
            </dl>
            <div className="public-tournament-card__series">
              {tournament.series.map((series) => (
                <span key={series.id}>
                  {series.name} · {series.remainingSlots} place
                  {series.remainingSlots > 1 ? "s" : ""}
                </span>
              ))}
            </div>
            <Link
              className="button button--primary"
              to={`${ROUTES.tournaments}/${tournament.id}`}
            >
              Voir le tournoi
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
