import { useEffect, useMemo, useState } from "react";
import { Trophy } from "lucide-react";
import {
  championshipResultsService,
  type ChampionshipOfficialResult,
  type ChampionshipResultsCatalogItem,
} from "@/features/user-space/championships/services/championshipResultsService";
import "./ChampionshipResultsExplorer.css";

type ResultsScope = "mine" | "club" | "all";

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

const resultOutcome = (
  result: ChampionshipOfficialResult,
  scope: ResultsScope,
) => {
  if (result.scoreTeam1 === null || result.scoreTeam2 === null) return null;
  if (result.scoreTeam1 === result.scoreTeam2) return "Résultat à vérifier";

  const winner =
    result.scoreTeam1 > result.scoreTeam2 ? ("team1" as const) : ("team2" as const);

  if (scope === "mine") {
    const mine =
      result.team1IsMyTeam ? "team1" : result.team2IsMyTeam ? "team2" : null;
    if (!mine) return null;
    return winner === mine ? "Victoire" : "Défaite";
  }

  if (scope === "club") {
    const clubSide =
      result.team1IsMyClub && !result.team2IsMyClub
        ? "team1"
        : result.team2IsMyClub && !result.team1IsMyClub
          ? "team2"
          : null;
    if (!clubSide) return null;
    return winner === clubSide ? "Victoire du club" : "Défaite du club";
  }

  return null;
};

function ResultTeam({
  label,
  club,
  players,
  score,
  winner,
  mine,
  myClub,
}: {
  label: string;
  club: string;
  players: string[];
  score: number | null;
  winner: boolean;
  mine: boolean;
  myClub: boolean;
}) {
  return (
    <div
      className={[
        "championship-results__team",
        winner ? "is-winner" : "",
        mine ? "is-mine" : "",
        myClub ? "is-my-club" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div>
        <strong>{label}</strong>
        <span>{club}</span>
        {players.length > 0 && <small>{players.join(" · ")}</small>}
      </div>
      <div className="championship-results__team-score">
        {winner && <Trophy aria-label="Vainqueur" />}
        <strong>{score ?? "—"}</strong>
      </div>
    </div>
  );
}

function ResultCard({
  result,
  scope,
}: {
  result: ChampionshipOfficialResult;
  scope: ResultsScope;
}) {
  const hasNumericScore =
    result.scoreTeam1 !== null && result.scoreTeam2 !== null;
  const team1Wins =
    hasNumericScore && Number(result.scoreTeam1) > Number(result.scoreTeam2);
  const team2Wins =
    hasNumericScore && Number(result.scoreTeam2) > Number(result.scoreTeam1);
  const outcome = resultOutcome(result, scope);

  return (
    <article className="championship-results__result">
      <header>
        <div>
          <strong>{displayDate(result.playedOn)}</strong>
          {displayTime(result.playedTime) && (
            <span>{displayTime(result.playedTime)}</span>
          )}
        </div>
        <div>
          <span>{result.divisionName}</span>
          <span>
            {result.phase}
            {result.poolCode ? ` · Poule ${result.poolCode}` : ""}
          </span>
        </div>
        {outcome && (
          <strong
            className={`championship-results__outcome is-${outcome
              .toLowerCase()
              .startsWith("victoire")
              ? "win"
              : outcome.toLowerCase().startsWith("défaite")
                ? "loss"
                : "invalid"}`}
          >
            {outcome}
          </strong>
        )}
      </header>

      <div className="championship-results__scoreboard">
        <ResultTeam
          label={result.team1Label}
          club={result.team1ClubName}
          players={result.team1Players}
          score={result.scoreTeam1}
          winner={Boolean(team1Wins)}
          mine={result.team1IsMyTeam}
          myClub={result.team1IsMyClub}
        />
        <ResultTeam
          label={result.team2Label}
          club={result.team2ClubName}
          players={result.team2Players}
          score={result.scoreTeam2}
          winner={Boolean(team2Wins)}
          mine={result.team2IsMyTeam}
          myClub={result.team2IsMyClub}
        />
      </div>

      {!hasNumericScore && result.scoreRaw && (
        <small className="championship-results__raw-score">
          Résultat officiel : {result.scoreRaw}
        </small>
      )}
      {result.venue && (
        <small className="championship-results__venue">{result.venue}</small>
      )}
    </article>
  );
}

export function ChampionshipResultsExplorer() {
  const [catalog, setCatalog] = useState<ChampionshipResultsCatalogItem[]>([]);
  const [results, setResults] = useState<ChampionshipOfficialResult[]>([]);
  const [selectedChampionshipId, setSelectedChampionshipId] = useState("");
  const [selectedDivisionId, setSelectedDivisionId] = useState("");
  const [selectedPoolId, setSelectedPoolId] = useState("all");
  const [scope, setScope] = useState<ResultsScope>("mine");
  const [visibleCount, setVisibleCount] = useState(50);
  const [loading, setLoading] = useState(true);
  const [resultsLoading, setResultsLoading] = useState(false);
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
              item.championshipStatus === "active" && item.hasMyTeam,
          ) ??
          items.find(
            (item) =>
              item.championshipStatus === "active" && item.hasMyClubTeam,
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
            : "Impossible de charger les résultats des championnats.",
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

    setScope(
      selectedChampionship.hasMyTeam
        ? "mine"
        : selectedChampionship.hasMyClubTeam
          ? "club"
          : "all",
    );

    const preferredDivision =
      selectedChampionship.divisions.find((division) =>
        selectedChampionship.myDivisionIds.includes(division.id),
      ) ?? selectedChampionship.divisions[0];
    setSelectedDivisionId(preferredDivision?.id ?? "");
    setSelectedPoolId("all");
  }, [selectedChampionship]);

  useEffect(() => {
    if (!selectedChampionshipId) {
      setResults([]);
      return;
    }

    let active = true;
    setResultsLoading(true);
    setError("");
    championshipResultsService
      .listResults(selectedChampionshipId)
      .then((items) => {
        if (active) setResults(items);
      })
      .catch((cause) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Impossible de charger les résultats.",
        );
      })
      .finally(() => {
        if (active) setResultsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedChampionshipId]);

  const scopedResults = useMemo(
    () =>
      results.filter((result) => {
        if (scope === "mine") {
          return result.team1IsMyTeam || result.team2IsMyTeam;
        }
        if (scope === "club") {
          return result.team1IsMyClub || result.team2IsMyClub;
        }
        return true;
      }),
    [results, scope],
  );

  const poolOptions = useMemo(() => {
    const pools = new Map<string, string>();
    for (const result of scopedResults) {
      if (result.divisionId !== selectedDivisionId || !result.poolId) continue;
      pools.set(
        result.poolId,
        result.poolName ?? `Poule ${result.poolCode ?? "—"}`,
      );
    }
    return [...pools.entries()].sort((left, right) =>
      left[1].localeCompare(right[1], "fr", { numeric: true }),
    );
  }, [scopedResults, selectedDivisionId]);

  const filteredResults = useMemo(
    () =>
      scopedResults.filter(
        (result) =>
          (!selectedDivisionId || result.divisionId === selectedDivisionId) &&
          (selectedPoolId === "all" || result.poolId === selectedPoolId),
      ),
    [scopedResults, selectedDivisionId, selectedPoolId],
  );

  useEffect(() => {
    setVisibleCount(50);
    setSelectedPoolId("all");
  }, [scope, selectedChampionshipId, selectedDivisionId]);

  if (loading) {
    return (
      <section className="championship-results">
        <div className="championship-results__state">Chargement des résultats…</div>
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
          <p>Résultats officiels</p>
          <h2 id="championship-results-title">
            Résultats du club et du championnat
          </h2>
          <span>
            Consultez votre équipe, les autres équipes du club ou toutes les
            séries et poules.
          </span>
        </div>
        <strong>{filteredResults.length} résultat(s)</strong>
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
          Équipes du club
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
            onChange={(event) => setSelectedDivisionId(event.target.value)}
          >
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
      ) : resultsLoading ? (
        <div className="championship-results__state">
          Chargement des résultats…
        </div>
      ) : filteredResults.length === 0 ? (
        <div className="championship-results__state">
          Aucun résultat officiel avec ces filtres.
        </div>
      ) : (
        <>
          <div className="championship-results__list">
            {filteredResults.slice(0, visibleCount).map((result) => (
              <ResultCard key={result.matchId} result={result} scope={scope} />
            ))}
          </div>
          {visibleCount < filteredResults.length && (
            <button
              type="button"
              className="championship-results__more"
              onClick={() => setVisibleCount((current) => current + 50)}
            >
              Afficher plus de résultats
            </button>
          )}
        </>
      )}
    </section>
  );
}
