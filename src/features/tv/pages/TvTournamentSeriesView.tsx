import { Trophy } from "lucide-react";
import type { TournamentRankingTeam } from "@/features/tournaments/services/tournamentRankingService";
import type { PublicTournamentResultMatch } from "@/features/tournaments/services/tournamentResultsService";
import type { TvTournamentSeries } from "@/features/tv/services/tvTournamentService";
import "./TvTournamentSeriesView.css";

const numberFormatter = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const compactDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  day: "2-digit",
  month: "2-digit",
});

const dateFromIso = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
};

const rankingValue = (
  team: TournamentRankingTeam,
  series: TvTournamentSeries,
) =>
  series.rankingMode === "points_per_match"
    ? numberFormatter.format(team.rankingValue)
    : String(team.rankingPoints);

const goalAverageValue = (
  team: TournamentRankingTeam,
  series: TvTournamentSeries,
) =>
  series.goalAverageMode === "point_difference_per_match"
    ? numberFormatter.format(team.goalAverageValue)
    : String(team.pointDifference);

const scoreLabel = (match: PublicTournamentResultMatch) => {
  if (match.resultStatus === "pending_validation") return "En validation";
  if (match.resultStatus !== "validated" || !match.score) return "À jouer";
  return match.score.sets.map((set) => `${set.teamA}–${set.teamB}`).join(" · ");
};

const matchMeta = (match: PublicTournamentResultMatch) => {
  if (!match.playDate) return match.resourceName;
  const date = compactDateFormatter.format(dateFromIso(match.playDate));
  return [date, match.startsAt, match.resourceName].filter(Boolean).join(" · ");
};

export function TvTournamentSeriesView({
  series,
}: {
  series: TvTournamentSeries;
}) {
  const rankingTitle =
    series.rankingMode === "points_per_match" ? "Pts/partie" : "Pts";
  const goalAverageTitle =
    series.goalAverageMode === "point_difference_per_match"
      ? "Diff./partie"
      : "Diff.";

  return (
    <section
      className="tv-tournament tv-display__view"
      aria-label={`${series.tournamentName} — ${series.seriesName}`}
    >
      <header className="tv-tournament__heading">
        <div>
          <span className="tv-tournament__kicker">
            <Trophy aria-hidden="true" /> Tournoi en cours
          </span>
          <h2>{series.tournamentName}</h2>
        </div>
        <strong style={{ borderColor: series.color }}>
          {series.seriesName}
        </strong>
      </header>

      <div className="tv-tournament__pools">
        {series.pools.map((pool) => (
          <article className="tv-tournament__pool" key={pool.id}>
            <header>
              <div>
                <h3>Poule {pool.number}</h3>
                <span>
                  {pool.validatedMatches}/{pool.totalMatches} résultat
                  {pool.totalMatches > 1 ? "s" : ""} validé
                  {pool.validatedMatches > 1 ? "s" : ""}
                </span>
              </div>
            </header>

            <div className="tv-tournament__pool-content">
              <div className="tv-tournament__ranking">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Cl.</th>
                      <th scope="col">Équipe</th>
                      <th scope="col">MJ</th>
                      <th scope="col">{rankingTitle}</th>
                      <th scope="col">{goalAverageTitle}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pool.teams.map((team) => (
                      <tr key={team.teamId}>
                        <td>
                          <strong>{team.position}</strong>
                        </td>
                        <th scope="row">{team.teamLabel}</th>
                        <td>{team.matchesPlayed}</td>
                        <td>{rankingValue(team, series)}</td>
                        <td>{goalAverageValue(team, series)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="tv-tournament__matches">
                <h4>Parties</h4>
                {pool.matches.length === 0 ? (
                  <p>Aucune partie publiée.</p>
                ) : (
                  pool.matches.map((match) => (
                    <div
                      className={`tv-tournament__match tv-tournament__match--${match.resultStatus ?? "scheduled"}`}
                      key={match.id}
                    >
                      <div className="tv-tournament__match-teams">
                        <span>{match.teamALabel}</span>
                        <strong>{scoreLabel(match)}</strong>
                        <span>{match.teamBLabel}</span>
                      </div>
                      <small>{matchMeta(match)}</small>
                    </div>
                  ))
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
