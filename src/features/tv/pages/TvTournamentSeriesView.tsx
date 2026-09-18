import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { CalendarClock, Trophy } from "lucide-react";
import type { TournamentRankingTeam } from "@/features/tournaments/services/tournamentRankingService";
import type { PublicTournamentResultMatch } from "@/features/tournaments/services/tournamentResultsService";
import type { TvTournamentSeries } from "@/features/tv/services/tvTournamentService";
import "./TvTournamentSeriesView.css";

const MAX_POOLS_PER_PAGE = 6;
const POOL_PAGE_DURATION_MS = 12_000;
const MAX_MATCHES_PER_COLUMN = 6;

export type TvTournamentSeriesPage = "ranking" | "matches";

type MatchWithPool = {
  match: PublicTournamentResultMatch;
  poolNumber: number;
};

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

const matchMeta = (match: PublicTournamentResultMatch) => {
  if (!match.playDate) return match.resourceName;
  const date = compactDateFormatter.format(dateFromIso(match.playDate));
  return [date, match.startsAt, match.resourceName].filter(Boolean).join(" · ");
};

const scoreLabel = (match: PublicTournamentResultMatch) => {
  if (match.score?.sets.length) {
    return match.score.sets
      .map((set) => `${set.teamA}–${set.teamB}`)
      .join(" · ");
  }

  if (match.teamASets !== null && match.teamBSets !== null) {
    return `${match.teamASets}–${match.teamBSets}`;
  }

  return "Résultat";
};

const scheduledKey = (match: PublicTournamentResultMatch) =>
  match.scheduledStartAt ||
  [match.playDate, match.startsAt].filter(Boolean).join("T") ||
  "9999";

const resultKey = (match: PublicTournamentResultMatch) =>
  match.scheduledStartAt ||
  [match.playDate, match.startsAt].filter(Boolean).join("T") ||
  "";

const poolPagePlan = (poolCount: number) => {
  const pageCount = Math.max(1, Math.ceil(poolCount / MAX_POOLS_PER_PAGE));
  const poolsPerPage = Math.max(1, Math.ceil(poolCount / pageCount));
  return { pageCount, poolsPerPage };
};

const poolGridStyle = (poolCount: number): CSSProperties => {
  if (poolCount <= 1) {
    return {
      gridTemplateColumns: "minmax(0, 1fr)",
      gridTemplateRows: "minmax(0, 1fr)",
    };
  }
  if (poolCount === 2) {
    return {
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gridTemplateRows: "minmax(0, 1fr)",
    };
  }
  if (poolCount === 3) {
    return {
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      gridTemplateRows: "minmax(0, 1fr)",
    };
  }
  if (poolCount === 4) {
    return {
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gridTemplateRows: "repeat(2, minmax(0, 1fr))",
    };
  }
  return {
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gridTemplateRows: "repeat(2, minmax(0, 1fr))",
  };
};

function TournamentHeading({
  series,
  page,
  poolPage,
  poolPageCount,
}: {
  series: TvTournamentSeries;
  page: TvTournamentSeriesPage;
  poolPage: number;
  poolPageCount: number;
}) {
  return (
    <header className="tv-tournament__heading">
      <div>
        <span className="tv-tournament__kicker">
          <Trophy aria-hidden="true" /> Tournoi en cours
        </span>
        <h2>{series.tournamentName}</h2>
      </div>
      <strong style={{ borderColor: series.color }}>
        {series.seriesName} · {page === "ranking" ? "Poules & classement" : "Résultats & matchs"}
        {page === "ranking" && poolPageCount > 1
          ? ` · ${poolPage + 1}/${poolPageCount}`
          : ""}
      </strong>
    </header>
  );
}

function RankingPage({ series }: { series: TvTournamentSeries }) {
  const rankingTitle =
    series.rankingMode === "points_per_match" ? "P/M" : "Pts";
  const goalAverageTitle =
    series.goalAverageMode === "point_difference_per_match" ? "D/M" : "Diff.";
  const { pageCount, poolsPerPage } = poolPagePlan(series.pools.length);
  const [poolPage, setPoolPage] = useState(0);

  useEffect(() => {
    setPoolPage(0);
  }, [series.viewKey, series.pools.length]);

  useEffect(() => {
    if (pageCount <= 1) return;

    const rotation = window.setInterval(() => {
      setPoolPage((current) => (current + 1) % pageCount);
    }, POOL_PAGE_DURATION_MS);

    return () => window.clearInterval(rotation);
  }, [pageCount]);

  const safePoolPage = Math.min(poolPage, pageCount - 1);
  const firstPoolIndex = safePoolPage * poolsPerPage;
  const visiblePools = series.pools.slice(
    firstPoolIndex,
    firstPoolIndex + poolsPerPage,
  );

  return (
    <>
      <TournamentHeading
        series={series}
        page="ranking"
        poolPage={safePoolPage}
        poolPageCount={pageCount}
      />

      <div
        className="tv-tournament__pools"
        style={poolGridStyle(visiblePools.length)}
      >
        {visiblePools.map((pool) => (
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

            <div className="tv-tournament__ranking">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Cl.</th>
                    <th scope="col">Équipe</th>
                    <th scope="col">J</th>
                    <th scope="col">V</th>
                    <th scope="col">D</th>
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
                      <td>{team.wins}</td>
                      <td>{team.losses}</td>
                      <td>{rankingValue(team, series)}</td>
                      <td>{goalAverageValue(team, series)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function MatchTeamLabel({ label }: { label: string }) {
  const separatorIndex = label.indexOf(" / ");
  const players =
    separatorIndex >= 0
      ? [label.slice(0, separatorIndex), label.slice(separatorIndex + 3)]
      : [label];

  return (
    <span className="tv-tournament__match-team">
      {players.map((player, index) => (
        <span key={`${index}:${player}`}>{player}</span>
      ))}
    </span>
  );
}

function MatchRow({
  item,
  kind,
}: {
  item: MatchWithPool;
  kind: "result" | "upcoming";
}) {
  const { match, poolNumber } = item;

  return (
    <article className="tv-tournament__match-row">
      <div className="tv-tournament__match-pool">Poule {poolNumber}</div>
      <div className="tv-tournament__match-row-main">
        <MatchTeamLabel label={match.teamALabel} />
        <strong>{kind === "result" ? scoreLabel(match) : "vs"}</strong>
        <MatchTeamLabel label={match.teamBLabel} />
      </div>
      <div className="tv-tournament__match-row-meta">
        <small>{matchMeta(match)}</small>
        {kind === "result" && match.resultStatus === "pending_validation" && (
          <em>À valider</em>
        )}
      </div>
    </article>
  );
}

function MatchesPage({ series }: { series: TvTournamentSeries }) {
  const allMatches = useMemo<MatchWithPool[]>(
    () =>
      series.pools.flatMap((pool) =>
        pool.matches.map((match) => ({ match, poolNumber: pool.number })),
      ),
    [series.pools],
  );

  const recentResults = useMemo(
    () =>
      allMatches
        .filter(({ match }) => match.resultStatus !== null)
        .slice()
        .sort(
          (left, right) =>
            resultKey(right.match).localeCompare(resultKey(left.match)) ||
            right.match.displayOrder - left.match.displayOrder,
        )
        .slice(0, MAX_MATCHES_PER_COLUMN),
    [allMatches],
  );

  const upcomingMatches = useMemo(
    () =>
      allMatches
        .filter(({ match }) => match.resultStatus === null)
        .slice()
        .sort(
          (left, right) =>
            scheduledKey(left.match).localeCompare(scheduledKey(right.match)) ||
            left.match.displayOrder - right.match.displayOrder,
        )
        .slice(0, MAX_MATCHES_PER_COLUMN),
    [allMatches],
  );

  return (
    <>
      <TournamentHeading
        series={series}
        page="matches"
        poolPage={0}
        poolPageCount={1}
      />

      <div className="tv-tournament__match-board">
        <section className="tv-tournament__match-column">
          <header>
            <Trophy aria-hidden="true" />
            <div>
              <span>Dernières parties jouées</span>
              <h3>Résultats</h3>
            </div>
          </header>
          <div className="tv-tournament__match-list">
            {recentResults.length > 0 ? (
              recentResults.map((item) => (
                <MatchRow item={item} kind="result" key={item.match.id} />
              ))
            ) : (
              <p className="tv-tournament__empty-match-list">
                Aucun résultat enregistré pour le moment.
              </p>
            )}
          </div>
        </section>

        <section className="tv-tournament__match-column">
          <header>
            <CalendarClock aria-hidden="true" />
            <div>
              <span>Programme de la série</span>
              <h3>Prochains matchs</h3>
            </div>
          </header>
          <div className="tv-tournament__match-list">
            {upcomingMatches.length > 0 ? (
              upcomingMatches.map((item) => (
                <MatchRow item={item} kind="upcoming" key={item.match.id} />
              ))
            ) : (
              <p className="tv-tournament__empty-match-list">
                Toutes les parties de poule sont jouées.
              </p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

export function TvTournamentSeriesView({
  series,
  page,
}: {
  series: TvTournamentSeries;
  page: TvTournamentSeriesPage;
}) {
  return (
    <section
      className="tv-tournament tv-display__view"
      aria-label={`${series.tournamentName} — ${series.seriesName} — ${
        page === "ranking" ? "classement" : "résultats et prochains matchs"
      }`}
    >
      {page === "ranking" ? (
        <RankingPage series={series} />
      ) : (
        <MatchesPage series={series} />
      )}
    </section>
  );
}
