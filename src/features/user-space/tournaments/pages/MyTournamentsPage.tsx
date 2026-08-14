import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { UserSpaceShell } from "@/features/user-space/components/UserSpaceShell";
import {
  myTournamentsService,
  type MyTournamentMatch,
  type MyTournamentOverview,
  type MyTournamentPlayer,
  type MyTournamentSportingRules,
} from "@/features/user-space/tournaments/services/myTournamentsService";
import {
  TournamentScoreEditor,
  type TournamentScorePayload,
} from "@/features/tournaments/components/TournamentScoreEditor";
import { ROUTES } from "@/shared/config";
import "./MyTournamentsPage.css";

const tournamentStatusLabels: Record<string, string> = {
  preparation: "Préparation",
  configuration: "Configuration",
  registrations_open: "Inscriptions ouvertes",
  registrations_closed: "Inscriptions fermées",
  pools_generated: "Poules générées",
  pools_validated: "Poules validées",
  planning_generated: "Planning en préparation",
  planning_published: "Planning publié",
  in_progress: "En cours",
  completed: "Terminé",
  archived: "Archivé",
  cancelled: "Annulé",
};

const teamStatusLabels = {
  pending: "En attente",
  accepted: "Inscrite",
  rejected: "Refusée",
  withdrawn: "Retirée",
} as const;

const longDate = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const shortDate = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

const roleLabels = { front: "Avant", back: "Arrière" } as const;

const dateAtNoon = (value: string) => new Date(`${value}T12:00:00`);
const matchDate = (match: MyTournamentMatch) =>
  new Date(`${match.playDate}T${match.startsAt || "00:00"}:00`);

const playerLabel = (player: MyTournamentPlayer) =>
  `${player.firstName} ${player.lastName}`.trim();

const teamLabel = (players: MyTournamentPlayer[]) =>
  players.map(playerLabel).filter(Boolean).join(" / ") || "Équipe";

const isTournamentHistory = (tournament: MyTournamentOverview) =>
  ["completed", "archived", "cancelled"].includes(tournament.status) ||
  dateAtNoon(tournament.endsOn).getTime() < Date.now();

const formatResult = (match: MyTournamentMatch) => {
  if (!match.result) return "";
  return match.result.score.sets
    .map((set) => {
      const mine = match.teamSide === "a" ? set.teamA : set.teamB;
      const opponent = match.teamSide === "a" ? set.teamB : set.teamA;
      return `${mine}-${opponent}`;
    })
    .join(" · ");
};

function MatchCard({
  match,
  rules,
  highlight = false,
  onResultSaved,
}: {
  match: MyTournamentMatch;
  rules: MyTournamentSportingRules;
  highlight?: boolean;
  onResultSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const isPast = matchDate(match).getTime() < Date.now();
  const opponent = teamLabel(match.opponentPlayers);
  const resultLabel = formatResult(match);

  const saveResult = async (score: TournamentScorePayload) => {
    setSaving(true);
    try {
      await myTournamentsService.submitResult(match.id, score);
      setEditing(false);
      await onResultSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <article
      className={`my-tournaments__match${highlight ? " my-tournaments__match--next" : ""}${isPast ? " my-tournaments__match--past" : ""}`}
    >
      <div className="my-tournaments__match-date">
        <strong>{shortDate.format(dateAtNoon(match.playDate))}</strong>
        <span>{match.startsAt}</span>
      </div>
      <div className="my-tournaments__match-opponent">
        <span>
          {highlight ? "Prochaine partie" : isPast ? "Partie jouée" : "À venir"}
        </span>
        <strong>vs {opponent}</strong>
        {match.result && (
          <div className="my-tournaments__result-summary">
            <strong>{resultLabel}</strong>
            <span>
              {match.result.status === "validated"
                ? "Résultat validé"
                : "Résultat transmis · validation du club en attente"}
            </span>
          </div>
        )}
      </div>
      <div className="my-tournaments__match-place">
        <strong>{match.resourceName}</strong>
        {match.poolNumber && <span>Poule {match.poolNumber}</span>}
        {match.canSubmitResult && !editing && (
          <button
            className="my-tournaments__result-button"
            type="button"
            onClick={() => setEditing(true)}
          >
            Saisir le résultat
          </button>
        )}
      </div>

      {editing && (
        <div className="my-tournaments__score-editor">
          <TournamentScoreEditor
            rules={rules}
            teamSide={match.teamSide}
            leftLabel="Notre équipe"
            rightLabel={opponent}
            disabled={saving}
            submitLabel={saving ? "Enregistrement…" : "Transmettre au club"}
            onCancel={() => setEditing(false)}
            onSubmit={saveResult}
          />
        </div>
      )}
    </article>
  );
}

function TournamentCard({
  tournament,
  onResultSaved,
}: {
  tournament: MyTournamentOverview;
  onResultSaved: () => Promise<void>;
}) {
  const upcomingMatches = tournament.matches.filter(
    (match) => matchDate(match).getTime() >= Date.now(),
  );
  const nextMatch = upcomingMatches[0] ?? null;
  const remainingMatches = nextMatch
    ? tournament.matches.filter((match) => match.id !== nextMatch.id)
    : tournament.matches;
  const style = {
    "--series-color": tournament.team.seriesColor,
  } as CSSProperties;

  return (
    <article className="my-tournaments__card" style={style}>
      <header className="my-tournaments__card-header">
        <div>
          <p className="my-tournaments__series">
            <span aria-hidden="true" /> {tournament.team.seriesName}
          </p>
          <h2>{tournament.name}</h2>
          <p>
            Du {longDate.format(dateAtNoon(tournament.startsOn))} au{" "}
            {longDate.format(dateAtNoon(tournament.endsOn))}
          </p>
        </div>
        <div className="my-tournaments__statuses">
          <span>{teamStatusLabels[tournament.team.status]}</span>
          <span>
            {tournamentStatusLabels[tournament.status] ?? tournament.status}
          </span>
        </div>
      </header>

      <div className="my-tournaments__team-block">
        <div>
          <p className="my-tournaments__label">Mon équipe</p>
          <div className="my-tournaments__players">
            {tournament.team.players.map((player) => (
              <div
                key={`${player.role}-${player.firstName}-${player.lastName}`}
              >
                <strong>{playerLabel(player)}</strong>
                <span>
                  {roleLabels[player.role]}
                  {player.clubName ? ` · ${player.clubName}` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="my-tournaments__pool">
          <span>Poule</span>
          <strong>{tournament.team.poolNumber ?? "—"}</strong>
        </div>
      </div>

      {!tournament.planningPublished ? (
        <div className="my-tournaments__planning-waiting">
          <strong>Planning en préparation</strong>
          <span>
            Vos parties apparaîtront ici dès que le club aura publié le
            planning.
          </span>
        </div>
      ) : tournament.matches.length === 0 ? (
        <div className="my-tournaments__planning-waiting">
          <strong>Aucune partie programmée</strong>
          <span>
            Le planning publié ne contient pas encore de partie pour votre
            équipe.
          </span>
        </div>
      ) : (
        <section className="my-tournaments__matches" aria-label="Mes parties">
          {nextMatch && (
            <MatchCard
              match={nextMatch}
              rules={tournament.sportingRules}
              highlight
              onResultSaved={onResultSaved}
            />
          )}
          {remainingMatches.length > 0 && (
            <details>
              <summary>
                Toutes mes parties ({tournament.matches.length})
              </summary>
              <div className="my-tournaments__match-list">
                {remainingMatches.map((match) => (
                  <MatchCard
                    key={match.id}
                    match={match}
                    rules={tournament.sportingRules}
                    onResultSaved={onResultSaved}
                  />
                ))}
              </div>
            </details>
          )}
        </section>
      )}

      <footer className="my-tournaments__actions">
        <Link to={`${ROUTES.tournaments}/${tournament.id}`}>
          {tournament.team.canManageRegistration
            ? "Gérer mon inscription"
            : "Voir le tournoi"}
        </Link>
      </footer>
    </article>
  );
}

export function MyTournamentsPage() {
  const [tournaments, setTournaments] = useState<MyTournamentOverview[]>([]);
  const [view, setView] = useState<"current" | "history">("current");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const items = await myTournamentsService.list();
    setTournaments(items);
  }, []);

  useEffect(() => {
    let active = true;
    myTournamentsService
      .list()
      .then((items) => {
        if (active) setTournaments(items);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Impossible de charger vos tournois.",
          );
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const refreshAfterResult = useCallback(async () => {
    setError(null);
    try {
      await load();
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Impossible d’actualiser vos tournois.",
      );
    }
  }, [load]);

  const displayed = useMemo(
    () =>
      tournaments.filter((tournament) =>
        view === "history"
          ? isTournamentHistory(tournament)
          : !isTournamentHistory(tournament),
      ),
    [tournaments, view],
  );

  return (
    <UserSpaceShell>
      <section
        className="my-tournaments"
        aria-labelledby="my-tournaments-title"
      >
        <header className="my-tournaments__page-header">
          <p className="my-tournaments__eyebrow">Espace personnel</p>
          <h1 id="my-tournaments-title">Mes tournois</h1>
          <p>
            Retrouvez votre équipe, vos parties et transmettez vos résultats au
            club après chaque rencontre.
          </p>
        </header>

        {error && (
          <p className="my-tournaments__alert" role="alert">
            {error}
          </p>
        )}

        <div
          className="my-tournaments__tabs"
          role="tablist"
          aria-label="Période des tournois"
        >
          <button
            type="button"
            role="tab"
            aria-selected={view === "current"}
            onClick={() => setView("current")}
          >
            En cours / à venir
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "history"}
            onClick={() => setView("history")}
          >
            Historique
          </button>
        </div>

        {isLoading ? (
          <p>Chargement de vos tournois…</p>
        ) : displayed.length === 0 ? (
          <div className="my-tournaments__empty">
            <h2>
              {view === "current"
                ? "Aucun tournoi en cours"
                : "Aucun tournoi dans l’historique"}
            </h2>
            <p>
              Les tournois auxquels votre équipe est inscrite apparaîtront
              automatiquement ici.
            </p>
          </div>
        ) : (
          <div className="my-tournaments__grid">
            {displayed.map((tournament) => (
              <TournamentCard
                key={tournament.id}
                tournament={tournament}
                onResultSaved={refreshAfterResult}
              />
            ))}
          </div>
        )}
      </section>
    </UserSpaceShell>
  );
}
