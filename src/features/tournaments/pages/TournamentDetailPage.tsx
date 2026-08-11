import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { TournamentRegistrationForm } from "@/features/tournaments/components/TournamentRegistrationForm";
import { tournamentService } from "@/features/tournaments/services/tournamentService";
import type {
  MyTournamentRegistration,
  PublicTournamentDetail,
} from "@/features/tournaments/types";
import { ROUTES } from "@/shared/config";
import { useAuth } from "@/shared/hooks/useAuth";
import "./TournamentsPage.css";

const registrationStatusLabels = {
  pending: "En attente de validation",
  accepted: "Inscription validée",
  rejected: "Inscription à corriger/refusée",
  withdrawn: "Inscription retirée",
} as const;

const playerRoleLabels = { front: "Avant", back: "Arrière" } as const;

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

export function TournamentDetailPage() {
  const { tournamentId = "" } = useParams();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [tournament, setTournament] = useState<PublicTournamentDetail | null>(
    null,
  );
  const [registration, setRegistration] =
    useState<MyTournamentRegistration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const publicTournament = await tournamentService.getPublic(tournamentId);
    setTournament(publicTournament);
    if (!publicTournament) {
      setRegistration(null);
      return;
    }

    if (isAuthenticated) {
      setRegistration(await tournamentService.getMine(tournamentId));
    } else {
      setRegistration(null);
    }
  }, [isAuthenticated, tournamentId]);

  useEffect(() => {
    if (authLoading) return;
    let active = true;
    setLoading(true);
    setError("");
    load()
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Impossible de charger le tournoi.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authLoading, load]);

  const teamsBySeries = useMemo(() => {
    const map = new Map<string, PublicTournamentDetail["teams"]>();
    for (const team of tournament?.teams ?? []) {
      map.set(team.seriesId, [...(map.get(team.seriesId) ?? []), team]);
    }
    return map;
  }, [tournament]);

  if (loading || authLoading) {
    return (
      <section className="public-tournaments">
        <p role="status">Chargement du tournoi…</p>
      </section>
    );
  }

  if (error && !tournament) {
    return (
      <section className="public-tournaments">
        <p className="public-tournaments__error" role="alert">
          {error}
        </p>
        <Link to={ROUTES.tournaments}>← Retour aux tournois</Link>
      </section>
    );
  }

  if (!tournament) {
    return (
      <section className="public-tournaments">
        <h1>Tournoi indisponible</h1>
        <p>Ce tournoi n’est pas encore publié ou n’existe plus.</p>
        <Link to={ROUTES.tournaments}>← Retour aux tournois</Link>
      </section>
    );
  }

  const canEditRegistration = tournament.canRegister && isAuthenticated;

  return (
    <section className="public-tournaments public-tournament-detail">
      <Link className="public-tournament-detail__back" to={ROUTES.tournaments}>
        ← Tous les tournois
      </Link>

      <header className="public-tournament-detail__hero">
        <div>
          <p>Tournoi</p>
          <h1>{tournament.name}</h1>
          {tournament.description && <span>{tournament.description}</span>}
        </div>
        <dl>
          <div>
            <dt>Période</dt>
            <dd>
              {formatDate(tournament.startsOn)} →{" "}
              {formatDate(tournament.endsOn)}
            </dd>
          </div>
          <div>
            <dt>Inscriptions</dt>
            <dd>
              {formatDateTime(tournament.registrationOpensAt)} →{" "}
              {formatDateTime(tournament.registrationClosesAt)}
            </dd>
          </div>
        </dl>
      </header>

      {error && (
        <p className="public-tournaments__error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="public-tournaments__success" role="status">
          {message}
        </p>
      )}

      {tournament.rules && (
        <section className="public-tournament-panel">
          <h2>Règlement & informations</h2>
          <p className="public-tournament-preline">{tournament.rules}</p>
        </section>
      )}

      <section className="public-tournament-panel public-tournament-panel--teams">
        <div className="public-tournament-panel__compact-heading">
          <h2>Équipes inscrites</h2>
          <span>{tournament.teamCount} équipe(s) validée(s)</span>
        </div>
        <div className="public-tournament-series-list">
          {tournament.series.map((series) => (
            <article key={series.id} className="public-tournament-series">
              <header>
                <div>
                  <h3>{series.name}</h3>
                  <span>
                    {series.acceptedCount}/{series.capacity}
                  </span>
                </div>
                <strong>{series.remainingSlots} libre(s)</strong>
              </header>
              {(teamsBySeries.get(series.id) ?? []).length === 0 ? (
                <p className="public-team-list__empty">Aucune équipe.</p>
              ) : (
                <div className="public-team-list">
                  {(teamsBySeries.get(series.id) ?? []).map((team) => (
                    <div className="public-team" key={team.id}>
                      {team.players.map((player) => (
                        <span key={`${team.id}-${player.role}`}>
                          <small>{playerRoleLabels[player.role]}</small>
                          <strong>
                            {player.firstName} {player.lastName}
                          </strong>
                          {player.clubName && <small>{player.clubName}</small>}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      <section
        className="public-tournament-panel public-registration-panel"
        id="inscription"
      >
        <div className="public-registration-panel__heading">
          <div>
            <p>Votre équipe</p>
            <h2>Inscription</h2>
          </div>
          {registration && (
            <span
              className={`public-registration-status public-registration-status--${registration.status}`}
            >
              {registrationStatusLabels[registration.status]}
            </span>
          )}
        </div>

        {!tournament.canRegister && (
          <p>
            Les inscriptions sont actuellement fermées. Les équipes déjà
            validées restent consultables ci-dessus.
          </p>
        )}

        {tournament.canRegister && !isAuthenticated && (
          <div className="public-registration-login">
            <p>
              Un compte Pelote Manager est nécessaire pour créer ou modifier une
              inscription.
            </p>
            <Link className="button button--primary" to={ROUTES.login}>
              Se connecter pour inscrire une équipe
            </Link>
          </div>
        )}

        {canEditRegistration && (
          <TournamentRegistrationForm
            tournament={tournament}
            registration={registration}
            onReload={load}
            onMessage={setMessage}
            onError={setError}
          />
        )}
      </section>
    </section>
  );
}
