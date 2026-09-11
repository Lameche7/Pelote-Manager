import { tournamentRankingService, type TournamentRankingTeam } from "@/features/tournaments/services/tournamentRankingService";
import {
  tournamentResultsService,
  type PublicTournamentResultMatch,
} from "@/features/tournaments/services/tournamentResultsService";
import { tournamentService } from "@/features/tournaments/services/tournamentService";

export type TvTournamentPool = {
  id: string;
  number: number;
  totalMatches: number;
  validatedMatches: number;
  teams: TournamentRankingTeam[];
  matches: PublicTournamentResultMatch[];
};

export type TvTournamentSeries = {
  viewKey: string;
  tournamentId: string;
  tournamentName: string;
  startsOn: string;
  endsOn: string;
  seriesId: string;
  seriesName: string;
  color: string;
  rankingMode: "total_points" | "points_per_match";
  goalAverageMode: "point_difference" | "point_difference_per_match";
  pools: TvTournamentPool[];
};

const CLUB_TIME_ZONE = "Europe/Paris";

const dateKeyInClubTimeZone = (date: Date) => {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: CLUB_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};

const tournamentIsCurrent = (
  startsOn: string,
  endsOn: string,
  today: string,
) => Boolean(startsOn && endsOn && startsOn <= today && today <= endsOn);

export const tvTournamentService = {
  async listCurrentSeries(now = new Date()): Promise<TvTournamentSeries[]> {
    const today = dateKeyInClubTimeZone(now);
    const tournaments = (await tournamentService.listPublic()).filter(
      (tournament) =>
        tournamentIsCurrent(tournament.startsOn, tournament.endsOn, today),
    );

    const loaded = await Promise.all(
      tournaments.map(async (tournament) => {
        try {
          const [rankings, results] = await Promise.all([
            tournamentRankingService.get(tournament.id),
            tournamentResultsService.get(tournament.id),
          ]);
          if (!rankings || !results) return [];

          return results.series
            .slice()
            .sort((left, right) => left.displayOrder - right.displayOrder)
            .map<TvTournamentSeries | null>((resultSeries) => {
              const rankingSeries = rankings.series.find(
                (series) => series.id === resultSeries.id,
              );
              if (!rankingSeries || rankingSeries.pools.length === 0) return null;

              return {
                viewKey: `tournament:${tournament.id}:${resultSeries.id}`,
                tournamentId: tournament.id,
                tournamentName: tournament.name,
                startsOn: tournament.startsOn,
                endsOn: tournament.endsOn,
                seriesId: resultSeries.id,
                seriesName: resultSeries.name,
                color: resultSeries.color,
                rankingMode: rankings.rankingMode,
                goalAverageMode: rankings.goalAverageMode,
                pools: rankingSeries.pools
                  .slice()
                  .sort((left, right) => left.number - right.number)
                  .map((rankingPool) => {
                    const resultPool = resultSeries.pools.find(
                      (pool) =>
                        pool.id === rankingPool.id ||
                        pool.number === rankingPool.number,
                    );
                    return {
                      id: rankingPool.id,
                      number: rankingPool.number,
                      totalMatches: rankingPool.totalMatches,
                      validatedMatches: rankingPool.validatedMatches,
                      teams: rankingPool.teams,
                      matches: (resultPool?.matches ?? [])
                        .slice()
                        .sort(
                          (left, right) =>
                            left.displayOrder - right.displayOrder,
                        ),
                    };
                  }),
              };
            })
            .filter((series): series is TvTournamentSeries => series !== null);
        } catch {
          // Un tournoi public momentanément indisponible ne doit pas casser le Mode TV.
          return [];
        }
      }),
    );

    return loaded.flat();
  },
};
