import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { TournamentRankings } from "@/features/tournaments/services/tournamentRankingService";
import type {
  PublicTournamentResultMatch,
  PublicTournamentResults,
} from "@/features/tournaments/services/tournamentResultsService";
import "./TournamentResultsBoard.css";

const matchDate = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

const metric = (value: number) =>
  Number.isInteger(value)
    ? String(value)
    : value.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

const scoreLabel = (match: PublicTournamentResultMatch) =>
  match.score?.sets
    .map((set) => `${set.teamA}–${set.teamB}`)
    .join("  ·  ") ?? "";

const matchState = (match: PublicTournamentResultMatch) => {
  if (match.resultStatus === "validated") return "validated";
  if (match.resultStatus === "pending_validation") return "pending";
  if (
    match.scheduledEndAt &&
    new Date(match.scheduledEndAt).getTime() <= Date.now()
  )
    return "missing";
  return "upcoming";
};

export function TournamentResultsBoard({
  results,
  rankings,
}: {
  results: PublicTournamentResults;
  rankings: TournamentRankings | null;
}) {
  const [selectedSeriesId, setSelectedSeriesId] = useState(
    () => results.series[0]?.id ?? "",
  );

  useEffect(() => {
    if (!results.series.some((series) => series.id === selectedSeriesId)) {
      setSelectedSeriesId(results.series[0]?.id ?? "");
    }
  }, [results.series, selectedSeriesId]);

  const selectedSeries = useMemo(
    () =>
      results.series.find((series) => series.id === selectedSeriesId) ??
      results.series[0] ??
      null,
    [results.series, selectedSeriesId],
  );

  const rankingSeries = rankings?.series.find(
    (series) => series.id === selectedSeries?.id,
  );

  if (!selectedSeries) {
    return (
      <div className="tournament-results-board__empty">
        Les poules ne sont pas encore disponibles.
      </div>
    );
  }

  const rankingLabel =
    rankings?.rankingMode === "points_per_match" ? "Pts/m" : "Pts";
  const goalAverageLabel =
    rankings?.goalAverageMode === "point_difference_per_match" ? "+/−/m" : "+/−";

  return (
    <div
      className="tournament-results-board"
      style={{ "--active-series": selectedSeries.color } as CSSProperties}
    >
      <nav
        className="tournament-results-board__series"
        aria-label="Séries du tournoi"
      >
        {results.series.map((series) => (
          <button
            key={series.id}
            type="button"
            className={
              series.id === selectedSeries.id
                ? "tournament-results-board__series-tab tournament-results-board__series-tab--active"
                : "tournament-results-board__series-tab"
            }
            style={{ "--series-color": series.color } as CSSProperties}
            aria-pressed={series.id === selectedSeries.id}
            onClick={() => setSelectedSeriesId(series.id)}
          >
            <span aria-hidden="true" />
            {series.name}
          </button>
        ))}
      </nav>

      <div className="tournament-results-board__pools">
        {selectedSeries.pools.map((pool) => {
          const rankingPool = rankingSeries?.pools.find(
            (item) => item.id === pool.id,
          );
          return (
            <section className="tournament-pool-results" key={pool.id}>
              <header className="tournament-pool-results__heading">
                <div>
                  <p>{selectedSeries.name}</p>
                  <h2>Poule {pool.number}</h2>
                </div>
                {rankingPool && (
                  <span>
                    {rankingPool.validatedMatches}/{rankingPool.totalMatches}{" "}
                    résultat(s)
                  </span>
                )}
              </header>

              <div className="tournament-pool-results__matches">
                <h3>Matchs</h3>
                {pool.matches.length === 0 ? (
                  <p className="tournament-results-board__empty">
                    Aucun match programmé.
                  </p>
                ) : (
                  <div className="tournament-match-results-list">
                    {pool.matches.map((match) => {
                      const state = matchState(match);
                      return (
                        <article
                          className={`tournament-result-match tournament-result-match--${state}`}
                          key={match.id}
                        >
                          <div className="tournament-result-match__meta">
                            <strong>
                              {matchDate.format(
                                new Date(`${match.playDate}T12:00:00`),
                              )}
                            </strong>
                            <span>
                              {match.startsAt} · {match.resourceName}
                            </span>
                          </div>
                          <div className="tournament-result-match__teams">
                            <strong>{match.teamALabel}</strong>
                            <div className="tournament-result-match__score">
                              {state === "validated" ? (
                                <strong>{scoreLabel(match)}</strong>
                              ) : state === "pending" ? (
                                <span>À valider</span>
                              ) : state === "missing" ? (
                                <span>Score attendu</span>
                              ) : (
                                <span>à venir</span>
                              )}
                            </div>
                            <strong>{match.teamBLabel}</strong>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="tournament-pool-results__ranking">
                <h3>Classement</h3>
                {!rankingPool || rankingPool.teams.length === 0 ? (
                  <p className="tournament-results-board__empty">
                    Le classement apparaîtra dès que les résultats seront validés.
                  </p>
                ) : (
                  <div className="tournament-pool-ranking-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Cl.</th>
                          <th>Équipe</th>
                          <th>MJ</th>
                          <th>{rankingLabel}</th>
                          <th>{goalAverageLabel}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rankingPool.teams.map((team) => (
                          <tr key={team.teamId}>
                            <td>
                              <strong>
                                {team.isTied ? "=" : ""}
                                {team.position}
                              </strong>
                            </td>
                            <td>{team.teamLabel}</td>
                            <td>{team.matchesPlayed}</td>
                            <td>{metric(team.rankingValue)}</td>
                            <td>
                              {team.goalAverageValue > 0 ? "+" : ""}
                              {metric(team.goalAverageValue)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
