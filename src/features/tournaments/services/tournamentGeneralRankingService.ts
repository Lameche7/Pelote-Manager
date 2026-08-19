import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

export type GeneralQualificationStatus =
  | "not_configured"
  | "provisional_qualifier"
  | "cutoff_tie"
  | "outside";

export type TournamentGeneralRankingTeam = {
  position: number;
  teamId: string;
  teamLabel: string;
  poolNumber: number;
  matchesPlayed: number;
  totalMatches: number;
  wins: number;
  losses: number;
  rankingPoints: number;
  rankingValue: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDifference: number;
  goalAverageValue: number;
  pointsForPerMatch: number;
  winPercentage: number;
  isTied: boolean;
  qualificationStatus: GeneralQualificationStatus;
};

export type TournamentGeneralRankingSeries = {
  id: string;
  name: string;
  qualifierCount: number;
  totalTeams: number;
  totalMatches: number;
  validatedMatches: number;
  cutoffTie: boolean;
  teams: TournamentGeneralRankingTeam[];
};

export type TournamentGeneralRankings = {
  tournamentId: string;
  tournamentName: string;
  status: string;
  rankingMode: "total_points" | "points_per_match";
  goalAverageMode: "point_difference" | "point_difference_per_match";
  series: TournamentGeneralRankingSeries[];
};

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

const mapGeneralRankings = (
  value: unknown,
): TournamentGeneralRankings | null => {
  if (!value || typeof value !== "object") return null;
  const root = value as Row;

  return {
    tournamentId: String(root.tournament_id ?? ""),
    tournamentName: String(root.tournament_name ?? ""),
    status: String(root.status ?? ""),
    rankingMode:
      root.ranking_mode === "total_points" ? "total_points" : "points_per_match",
    goalAverageMode:
      root.goal_average_mode === "point_difference"
        ? "point_difference"
        : "point_difference_per_match",
    series: rows(root.series).map((series) => ({
      id: String(series.id ?? ""),
      name: String(series.name ?? "Série"),
      qualifierCount: Number(series.qualifier_count ?? 0),
      totalTeams: Number(series.total_teams ?? 0),
      totalMatches: Number(series.total_matches ?? 0),
      validatedMatches: Number(series.validated_matches ?? 0),
      cutoffTie: Boolean(series.cutoff_tie),
      teams: rows(series.teams).map((team) => ({
        position: Number(team.position ?? 0),
        teamId: String(team.team_id ?? ""),
        teamLabel: String(team.team_label ?? "Équipe"),
        poolNumber: Number(team.pool_number ?? 0),
        matchesPlayed: Number(team.matches_played ?? 0),
        totalMatches: Number(team.total_matches ?? 0),
        wins: Number(team.wins ?? 0),
        losses: Number(team.losses ?? 0),
        rankingPoints: Number(team.ranking_points ?? 0),
        rankingValue: Number(team.ranking_value ?? 0),
        pointsFor: Number(team.points_for ?? 0),
        pointsAgainst: Number(team.points_against ?? 0),
        pointDifference: Number(team.point_difference ?? 0),
        goalAverageValue: Number(team.goal_average_value ?? 0),
        pointsForPerMatch: Number(team.points_for_per_match ?? 0),
        winPercentage: Number(team.win_percentage ?? 0),
        isTied: Boolean(team.is_tied),
        qualificationStatus: String(
          team.qualification_status ?? "not_configured",
        ) as GeneralQualificationStatus,
      })),
    })),
  };
};

export const tournamentGeneralRankingService = {
  async get(tournamentId: string): Promise<TournamentGeneralRankings | null> {
    const { data, error } = await supabase.rpc(
      "get_tournament_general_rankings",
      { target_tournament_id: tournamentId },
    );

    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de charger le classement général.",
        ),
      );
    }

    return mapGeneralRankings(data);
  },
};
