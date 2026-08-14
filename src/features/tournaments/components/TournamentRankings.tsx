import type {
  TournamentRankings as TournamentRankingsPayload,
  TournamentRankingTeam,
} from "@/features/tournaments/services/tournamentRankingService";
import "./TournamentRankings.css";

type Props = {
  rankings: TournamentRankingsPayload;
  compact?: boolean;
};

const numberFormatter = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

const valueLabel = (
  team: TournamentRankingTeam,
  rankings: TournamentRankingsPayload,
) =>
  rankings.rankingMode === "points_per_match"
    ? numberFormatter.format(team.rankingValue)
    : String(team.rankingPoints);

const goalAverageLabel = (
  team: TournamentRankingTeam,
  rankings: TournamentRankingsPayload,
) =>
  rankings.goalAverageMode === "point_difference_per_match"
    ? numberFormatter.format(team.goalAverageValue)
    : String(team.pointDifference);

export function TournamentRankings({ rankings, compact = false }: Props) {
  const rankingTitle =
    rankings.rankingMode === "points_per_match"
      ? "Pts / partie"
      : "Points classement";
  const goalAverageTitle =
    rankings.goalAverageMode === "point_difference_per_match"
      ? "Diff. / partie"
      : "Différence";

  return (
    <section
      className={`tournament-rankings${compact ? " tournament-rankings--compact" : ""}`}
    >
      <div className="tournament-rankings__heading">
        <div>
          <p>Ranking Engine</p>
          <h2>Classements des poules</h2>
        </div>
        <span>Résultats validés uniquement</span>
      </div>

      {rankings.series.length === 0 ? (
        <p className="tournament-rankings__empty">Aucune poule publiée.</p>
      ) : (
        <div className="tournament-rankings__series">
          {rankings.series.map((series) => (
            <section className="tournament-ranking-series" key={series.id}>
              <h3>{series.name}</h3>
              <div className="tournament-ranking-series__pools">
                {series.pools.map((pool) => (
                  <article className="tournament-ranking-pool" key={pool.id}>
                    <header>
                      <strong>Poule {pool.number}</strong>
                      <span>
                        {pool.validatedMatches}/{pool.totalMatches} résultat
                        {pool.totalMatches > 1 ? "s" : ""} validé
                        {pool.validatedMatches > 1 ? "s" : ""}
                      </span>
                    </header>
                    <div className="tournament-ranking-pool__scroll">
                      <table>
                        <thead>
                          <tr>
                            <th scope="col">Cl.</th>
                            <th scope="col">Équipe</th>
                            <th scope="col">MJ</th>
                            <th scope="col">G</th>
                            <th scope="col">P</th>
                            <th scope="col">Pts</th>
                            <th scope="col">{rankingTitle}</th>
                            <th scope="col">{goalAverageTitle}</th>
                            <th scope="col">Pour</th>
                            <th scope="col">Contre</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pool.teams.map((team) => (
                            <tr key={team.teamId}>
                              <td>
                                <strong>{team.position}</strong>
                                {team.isTied && (
                                  <span
                                    className="tournament-ranking-tie"
                                    title="Égalité sur les critères de classement configurés"
                                  >
                                    =
                                  </span>
                                )}
                              </td>
                              <th scope="row">{team.teamLabel}</th>
                              <td>{team.matchesPlayed}</td>
                              <td>{team.wins}</td>
                              <td>{team.losses}</td>
                              <td>{team.rankingPoints}</td>
                              <td>{valueLabel(team, rankings)}</td>
                              <td>{goalAverageLabel(team, rankings)}</td>
                              <td>{team.pointsFor}</td>
                              <td>{team.pointsAgainst}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {rankings.series.some((series) =>
        series.pools.some((pool) => pool.teams.some((team) => team.isTied)),
      ) && (
        <p className="tournament-rankings__note">
          Le signe = indique une égalité sur les deux critères configurés. Le
          départage sportif final sera appliqué séparément avant qualification.
        </p>
      )}
    </section>
  );
}
