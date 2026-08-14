import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { tournamentService } from "@/features/tournaments/services/tournamentService";
import type { PublicTournamentSummary } from "@/features/tournaments/types";
import { ROUTES } from "@/shared/config";
import "./HomeTournaments.css";

const formatDate = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  });

const registrationIsOpen = (
  tournament: PublicTournamentSummary,
  now: number,
) => {
  const opensAt = Date.parse(tournament.registrationOpensAt);
  const closesAt = Date.parse(tournament.registrationClosesAt);
  return (
    tournament.status === "registrations_open" &&
    Number.isFinite(opensAt) &&
    Number.isFinite(closesAt) &&
    opensAt <= now &&
    closesAt > now
  );
};

const tournamentIsCurrent = (
  tournament: PublicTournamentSummary,
  today: string,
) => tournament.endsOn >= today && tournament.status !== "archived";

export function HomeTournaments() {
  const [tournaments, setTournaments] = useState<PublicTournamentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const items = await tournamentService.listPublic();
      setTournaments(items);
      setNow(Date.now());
    } catch {
      setTournaments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();

    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    const interval = window.setInterval(refresh, 60_000);

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  const currentTournaments = useMemo(() => {
    const today = new Date(now).toLocaleDateString("sv-SE", {
      timeZone: "Europe/Paris",
    });
    return tournaments.filter((tournament) =>
      tournamentIsCurrent(tournament, today),
    );
  }, [now, tournaments]);

  if (!loading && currentTournaments.length === 0) return null;
  if (loading && currentTournaments.length === 0) return null;

  return (
    <section
      className="home-tournaments"
      aria-labelledby="home-tournaments-title"
    >
      <div className="home-tournaments__inner">
        <header className="home-tournaments__heading">
          <p className="section-kicker">Compétitions</p>
          <h2 id="home-tournaments-title">Tournois du club</h2>
          <p>
            Retrouvez les tournois en cours et inscrivez votre équipe dès
            l’ouverture des inscriptions.
          </p>
        </header>

        <div className="home-tournaments__grid">
          {currentTournaments.map((tournament) => {
            const isOpen = registrationIsOpen(tournament, now);
            const opensLater = Date.parse(tournament.registrationOpensAt) > now;
            const target = `${ROUTES.tournaments}/${tournament.id}${
              isOpen ? "#inscription" : ""
            }`;

            return (
              <article className="home-tournament-card" key={tournament.id}>
                <div className="home-tournament-card__topline">
                  <span
                    className={
                      isOpen
                        ? "home-tournament-card__status home-tournament-card__status--open"
                        : "home-tournament-card__status"
                    }
                  >
                    {isOpen
                      ? "Inscriptions ouvertes"
                      : opensLater
                        ? `Ouverture le ${formatDateTime(tournament.registrationOpensAt)}`
                        : "Tournoi publié"}
                  </span>
                  <strong>
                    {tournament.teamCount} équipe
                    {tournament.teamCount > 1 ? "s" : ""}
                  </strong>
                </div>

                <h3>{tournament.name}</h3>
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
                    <dd>
                      {tournament.series
                        .map((series) => series.name)
                        .join(" · ")}
                    </dd>
                  </div>
                </dl>

                <Link className="button button--primary" to={target}>
                  {isOpen ? "S’inscrire" : "Voir le tournoi"}
                </Link>
              </article>
            );
          })}
        </div>

        <Link className="home-tournaments__all-link" to={ROUTES.tournaments}>
          Voir tous les tournois →
        </Link>
      </div>
    </section>
  );
}
