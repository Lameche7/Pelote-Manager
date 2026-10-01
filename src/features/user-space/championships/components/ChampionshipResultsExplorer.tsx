import { useEffect, useMemo, useState } from "react";
import { Trophy } from "lucide-react";
import {
  championshipResultsService,
  type ChampionshipBrowserMatch,
  type ChampionshipResultsCatalogItem,
} from "@/features/user-space/championships/services/championshipResultsService";
import "./ChampionshipResultsExplorer.css";

type MatchScope = "mine" | "club" | "all";

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const displayDate = (value: string | null) => {
  if (!value) return "Date non renseignée";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
};

const displayTime = (value: string | null) =>
  value ? value.slice(0, 5) : null;

const outcomeLabel = (match: ChampionshipBrowserMatch, scope: MatchScope) => {
  const left = match.displayedScoreTeam1;
  const right = match.displayedScoreTeam2;
  if (left === null || right === null) return null;
  if (left === right) return "Résultat à vérifier";

  const winner = left > right ? "team1" : "team2";

  if (scope === "mine") {
    const mine = match.team1IsMyTeam
      ? "team1"
      : match.team2IsMyTeam
        ? "team2"
        : null;
    if (!mine) return null;
    return winner === mine ? "Victoire" : "Défaite";
  }

  if (scope === "club") {
    const clubSide =
      match.team1IsMyClub && !match.team2IsMyClub
        ? "team1"
        : match.team2IsMyClub && !match.team1IsMyClub
          ? "team2"
          : null;
    if (!clubSide) return null;
    return winner === clubSide ? "Victoire du club" : "Défaite du club";
  }

  return null;
};

function MatchCard({
  match,
  scope,
}: {
  match: ChampionshipBrowserMatch;
  scope: MatchScope;
}) {
  const left = match.displayedScoreTeam1;
  const right = match.displayedScoreTeam2;
  const leftWins = left !== null && right !== null && left > right;
  const rightWins = left !== null && right !== null && right > left;
  const outcome = outcomeLabel(match, scope);
  const theoreticalOnly = match.scheduleSource === "theoretical";

  return (
    <article className="championship-results__result">
      <header>
        <div>
          <strong>{displayDate(match.effectiveOn)}</strong>
          {displayTime(match.effectiveTime) ? (
            <span>{displayTime(match.effectiveTime)}</span>
          ) : theoreticalOnly ? (
            <span>Date théorique · dimanche</span>
          ) : (
            <span>Horaire à définir</span>
          )}
        </div>
        <div>
          <span>{match.divisionName}</span>
          <span>
            {match.phase}
            {match.poolCode ? ` · Poule ${match.poolCode}` : ""}
          </span>
        </div>
        {outcome && (
          <strong
            className={`championship-results__outcome is-${
              outcome.startsWith("Victoire")
                ? "win"
                : outcome.startsWith("Défaite")
                  ? "loss"
                  : "invalid"
            }`}
          >
            {outcome}
          </strong>
        )}
      </header>

      <div className="championship-results__scoreboard">
        <div
          className={[
            "championship-results__team",
            leftWins ? "is-winner" : "",
            match.team1IsMyTeam ? "is-mine" : "",
            match.team1IsMyClub ? "is-my-club" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <div>
            <strong>{match.team1Label}</strong>
            <span>{match.team1ClubName}</span>
            {match.team1Players.length > 0 && (
              <small>{match.team1Players.join(" · ")}</small>
            )}
          </div>
          <div className="championship-results__team-score">
            {leftWins && <Trophy aria-label="Vainqueur" />}
            <strong>{left ?? "—"}</strong>
          </div>
        </div>

        <div
          className={[
            "championship-results__team",
            rightWins ? "is-winner" : "",
            match.team2IsMyTeam ? "is-mine" : "",
            match.team2IsMyClub ? "is-my-club" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <div>
            <strong>{match.team2Label}</strong>
            <span>{match.team2ClubName}</span>
            {match.team2Players.length > 0 && (
              <small>{match.team2Players.join(" · ")}</small>
            )}
          </div>
          <div className="championship-results__team-score">
            {rightWins && <Trophy aria-label="Vainqueur" />}
            <strong>{right ?? "—"}</strong>
          </div>
        </div>
      </div>

      <div className="championship-results__meta">
        {match.resultSource === "official" ? (
          <strong>Résultat officiel</strong>
        ) : match.resultSource === "proposed" ? (
          <strong>
            Résultat proposé
            {match.proposedByTeamLabel
              ? ` par ${match.proposedByTeamLabel}`
              : ""}
          </strong>
        ) : (
          <strong>Résultat en attente</strong>
        )}
        {match.venue && <span>{match.venue}</span>}
      </div>
    </article>
  );
}

export function ChampionshipResultsExplorer() {
  const [catalog, setCatalog] = useState<ChampionshipResultsCatalogItem[]>([]);
  const [matches, setMatches] = useState<ChampionshipBrowserMatch[]>([]);
  const [selectedChampionshipId, setSelectedChampionshipId] = useState("");
  const [selectedDivisionId, setSelectedDivisionId] = useState("all");
  const [selectedPoolId, setSelectedPoolId] = useState("all");
  const [scope, setScope] = useState<MatchScope>("club");
  const [loading, setLoading] = useState(true);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    championshipResultsService
      .listCatalog()
      .then((items) => {
        if (!active) return;
        setCatalog(items);
        const preferred =
          items.find(
            (item) =>
              item.championshipStatus === "active" && item.hasMyClubTeam,
          ) ??
          items.find(
            (item) => item.championshipStatus === "active" && item.hasMyTeam,
          ) ??
          items.find((item) => item.championshipStatus === "active") ??
          items[0];
        if (preferred) setSelectedChampionshipId(preferred.championshipId);
      })
      .catch((cause) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Impossible de charger les championnats.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedChampionship = useMemo(
    () =>
      catalog.find(
        (item) => item.championshipId === selectedChampionshipId,
      ) ?? null,
    [catalog, selectedChampionshipId],
  );

  useEffect(() => {
    if (!selectedChampionship) return;
    setSelectedDivisionId("all");
    setSelectedPoolId("all");
    setScope(selectedChampionship.hasMyClubTeam ? "club" : "all");
  }, [selectedChampionship]);

  useEffect(() => {
    if (!selectedChampionshipId) return;
    let active = true;
    setMatchesLoading(true);
    setError("");
    championshipResultsService
      .listMatches(selectedChampionshipId)
      .then((items) => {
        if (active) setMatches(items);
      })
      .catch((cause) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Impossible de charger les rencontres.",
        );
      })
      .finally(() => {
        if (active) setMatchesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedChampionshipId]);

  const scopedMatches = useMemo(
    () =>
      matches.filter((match) => {
        if (scope === "mine") {
          return match.team1IsMyTeam || match.team2IsMyTeam;
        }
        if (scope === "club") {
          return match.team1IsMyClub || match.team2IsMyClub;
        }
        return true;
      }),
    [matches, scope],
  );

  const poolOptions = useMemo(() => {
    const pools = new Map<string, string>();
    for (const match of scopedMatches) {
      if (
        selectedDivisionId !== "all" &&
        match.divisionId !== selectedDivisionId
      ) {
        continue;
      }
      if (!match.poolId) continue;
      pools.set(
        match.poolId,
        match.poolName ?? `Poule ${match.poolCode ?? "—"}`,
      );
    }
    return [...pools.entries()].sort((left, right) =>
      left[1].localeCompare(right[1], "fr", { numeric: true }),
    );
  }, [scopedMatches, selectedDivisionId]);

  const filteredMatches = useMemo(
    () =>
      scopedMatches.filter(
        (match) =>
          (selectedDivisionId === "all" ||
            match.divisionId === selectedDivisionId) &&
          (selectedPoolId === "all" || match.poolId === selectedPoolId),
      ),
    [scopedMatches, selectedDivisionId, selectedPoolId],
  );

  if (loading) {
    return (
      <section className="championship-results">
        <div className="championship-results__state">
          Chargement des championnats…
        </div>
      </section>
    );
  }

  if (catalog.length === 0) return null;

  return (
    <section
      className="championship-results"
      aria-labelledby="championship-results-title"
    >
      <header className="championship-results__heading">
        <div>
          <p>Navigation globale</p>
          <h2 id="championship-results-title">
            Toutes les rencontres du championnat
          </h2>
          <span>
            Calendrier, scores proposés par les équipes puis résultats officiels
            dès leur mise à jour.
          </span>
        </div>
        <strong>{filteredMatches.length} partie(s)</strong>
      </header>

      <div className="championship-results__scope" role="tablist">
        <button
          type="button"
          className={scope === "mine" ? "is-active" : undefined}
          onClick={() => setScope("mine")}
          disabled={!selectedChampionship?.hasMyTeam}
        >
          Mon équipe
        </button>
        <button
          type="button"
          className={scope === "club" ? "is-active" : undefined}
          onClick={() => setScope("club")}
          disabled={!selectedChampionship?.hasMyClubTeam}
        >
          Toutes les équipes du club
        </button>
        <button
          type="button"
          className={scope === "all" ? "is-active" : undefined}
          onClick={() => setScope("all")}
        >
          Tout le championnat
        </button>
      </div>

      <div className="championship-results__filters">
        <label>
          <span>Championnat</span>
          <select
            value={selectedChampionshipId}
            onChange={(event) =>
              setSelectedChampionshipId(event.target.value)
            }
          >
            {catalog.map((item) => (
              <option key={item.championshipId} value={item.championshipId}>
                {item.seasonLabel} · {item.specialty}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Série</span>
          <select
            value={selectedDivisionId}
            onChange={(event) => {
              setSelectedDivisionId(event.target.value);
              setSelectedPoolId("all");
            }}
          >
            <option value="all">Toutes les séries</option>
            {selectedChampionship?.divisions.map((division) => (
              <option key={division.id} value={division.id}>
                {division.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Poule</span>
          <select
            value={selectedPoolId}
            onChange={(event) => setSelectedPoolId(event.target.value)}
          >
            <option value="all">Toutes les poules</option>
            {poolOptions.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <div className="championship-results__state is-error" role="alert">
          {error}
        </div>
      ) : matchesLoading ? (
        <div className="championship-results__state">
          Chargement des rencontres…
        </div>
      ) : filteredMatches.length === 0 ? (
        <div className="championship-results__state">
          Aucune rencontre avec ces filtres.
        </div>
      ) : (
        <div className="championship-results__list">
          {filteredMatches.map((match) => (
            <MatchCard key={match.matchId} match={match} scope={scope} />
          ))}
        </div>
      )}
    </section>
  );
}
