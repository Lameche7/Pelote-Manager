import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

export type MyTournamentStatisticsMatch = {
  matchId: string;
  tournamentId: string;
  tournamentName: string;
  specialty: string;
  seasonLabel: string;
  seriesId: string;
  seriesName: string;
  phase: string;
  teamSide: "a" | "b";
  opponentLabel: string;
  playDate: string | null;
  scoreMine: number;
  scoreOpponent: number;
  won: boolean;
  matchFormat: string;
  singleGamePoints: number;
  mainSetPoints: number;
  decidingSetPoints: number;
};

const mapMatch = (row: Row): MyTournamentStatisticsMatch => ({
  matchId: String(row.match_id ?? ""),
  tournamentId: String(row.tournament_id ?? ""),
  tournamentName: String(row.tournament_name ?? ""),
  specialty: String(row.specialty ?? "Discipline non renseignée"),
  seasonLabel: String(row.season_label ?? ""),
  seriesId: String(row.series_id ?? ""),
  seriesName: String(row.series_name ?? ""),
  phase: String(row.phase ?? ""),
  teamSide: row.team_side === "b" ? "b" : "a",
  opponentLabel: String(row.opponent_label ?? "Équipe adverse"),
  playDate: row.play_date ? String(row.play_date) : null,
  scoreMine: Number(row.score_mine ?? 0),
  scoreOpponent: Number(row.score_opponent ?? 0),
  won: Boolean(row.won),
  matchFormat: String(row.match_format ?? ""),
  singleGamePoints: Number(row.single_game_points ?? 0),
  mainSetPoints: Number(row.main_set_points ?? 0),
  decidingSetPoints: Number(row.deciding_set_points ?? 0),
});

export const myTournamentStatisticsService = {
  async list(): Promise<MyTournamentStatisticsMatch[]> {
    const { data, error } = await supabase.rpc("get_my_tournament_statistics");
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de charger vos statistiques de tournoi.",
        ),
      );
    }
    return rows(data).map(mapMatch).filter((row) => row.matchId);
  },
};
