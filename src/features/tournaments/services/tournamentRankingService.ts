import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

export type TournamentRankingMode = "total_points" | "points_per_match";
export type TournamentGoalAverageMode =
  "point_difference" | "point_difference_per_match";

export type TournamentRankingTeam = {
  position: number;
  teamId: string;
  teamLabel: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  rankingPoints: number;
  rankingValue: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDifference: number;
  goalAverageValue: number;
  isTied: boolean;
};

export type TournamentRankingPool = {
  id: string;
  number: number;
  totalMatches: number;
  validatedMatches: number;
  teams: TournamentRankingTeam[];
};

export type TournamentRankingSeries = {
  id: string;
  name: string;
  pools: TournamentRankingPool[];
};

export type TournamentRankings = {
  tournamentId: string;
  tournamentName: string;
  status: string;
  rankingMode: TournamentRankingMode;
  goalAverageMode: TournamentGoalAverageMode;
  series: TournamentRankingSeries[];
};

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

const mapRankings = (value: unknown): TournamentRankings | null => {
  if (!value || typeof value !== "object") return null;
  const row = value as Row;
  return {
    tournamentId: String(row.tournament_id ?? ""),
    tournamentName: String(row.tournament_name ?? ""),
    status: String(row.status ?? ""),
    rankingMode:
      row.ranking_mode === "total_points" ? "total_points" : "points_per_match",
    goalAverageMode:
      row.goal_average_mode === "point_difference"
        ? "point_difference"
        : "point_difference_per_match",
    series: rows(row.series).map((series) => ({
      id: String(series.id ?? ""),
      name: String(series.name ?? ""),
      pools: rows(series.pools).map((pool) => ({
        id: String(pool.id ?? ""),
        number: Number(pool.number ?? 0),
        totalMatches: Number(pool.total_matches ?? 0),
        validatedMatches: Number(pool.validated_matches ?? 0),
        teams: rows(pool.teams).map((team) => ({
          position: Number(team.position ?? 0),
          teamId: String(team.team_id ?? ""),
          teamLabel: String(team.team_label ?? "Équipe"),
          matchesPlayed: Number(team.matches_played ?? 0),
          wins: Number(team.wins ?? 0),
          losses: Number(team.losses ?? 0),
          rankingPoints: Number(team.ranking_points ?? 0),
          rankingValue: Number(team.ranking_value ?? 0),
          pointsFor: Number(team.points_for ?? 0),
          pointsAgainst: Number(team.points_against ?? 0),
          pointDifference: Number(team.point_difference ?? 0),
          goalAverageValue: Number(team.goal_average_value ?? 0),
          isTied: Boolean(team.is_tied),
        })),
      })),
    })),
  };
};

export const tournamentRankingService = {
  async get(tournamentId: string): Promise<TournamentRankings | null> {
    const { data, error } = await supabase.rpc("get_tournament_rankings", {
      target_tournament_id: tournamentId,
    });
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(error, "Impossible de charger le classement."),
      );
    }
    return mapRankings(data);
  },
};
