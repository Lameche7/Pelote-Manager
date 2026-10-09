import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

const nullableString = (value: unknown) =>
  value === null || value === undefined || value === "" ? null : String(value);

const nullableNumber = (value: unknown) =>
  value === null || value === undefined || value === "" ? null : Number(value);

export type AdminChampionshipDayResult = {
  matchId: string;
  championshipId: string;
  dayOn: string | null;
  actualOn: string | null;
  actualTime: string | null;
  divisionId: string;
  divisionName: string;
  divisionDisplayOrder: number;
  poolCode: string | null;
  team1Id: string;
  team1Label: string;
  team1Players: string[];
  team1IsClub: boolean;
  team2Id: string;
  team2Label: string;
  team2Players: string[];
  team2IsClub: boolean;
  clubIsHome: boolean;
  proposedScoreTeam1: number | null;
  proposedScoreTeam2: number | null;
  proposedByTeamLabel: string | null;
  proposalStatus: string | null;
  officialScoreTeam1: number | null;
  officialScoreTeam2: number | null;
};

const mapRow = (row: Row): AdminChampionshipDayResult => ({
  matchId: String(row.match_id ?? ""),
  championshipId: String(row.championship_id ?? ""),
  dayOn: nullableString(row.day_on),
  actualOn: nullableString(row.actual_on),
  actualTime: nullableString(row.actual_time),
  divisionId: String(row.division_id ?? ""),
  divisionName: String(row.division_name ?? ""),
  divisionDisplayOrder: Number(row.division_display_order ?? 0),
  poolCode: nullableString(row.pool_code),
  team1Id: String(row.team1_id ?? ""),
  team1Label: String(row.team1_label ?? ""),
  team1Players: Array.isArray(row.team1_players)
    ? row.team1_players.map(String)
    : [],
  team1IsClub: Boolean(row.team1_is_club),
  team2Id: String(row.team2_id ?? ""),
  team2Label: String(row.team2_label ?? ""),
  team2Players: Array.isArray(row.team2_players)
    ? row.team2_players.map(String)
    : [],
  team2IsClub: Boolean(row.team2_is_club),
  clubIsHome: Boolean(row.club_is_home),
  proposedScoreTeam1: nullableNumber(row.proposed_score_team1),
  proposedScoreTeam2: nullableNumber(row.proposed_score_team2),
  proposedByTeamLabel: nullableString(row.proposed_by_team_label),
  proposalStatus: nullableString(row.proposal_status),
  officialScoreTeam1: nullableNumber(row.official_score_team1),
  officialScoreTeam2: nullableNumber(row.official_score_team2),
});

export const adminChampionshipDayResultsService = {
  async list(championshipId: string): Promise<AdminChampionshipDayResult[]> {
    const { data, error } = await supabase.rpc(
      "admin_list_championship_day_results_v2",
      { target_id: championshipId },
    );
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de charger le récapitulatif des résultats.",
        ),
      );
    }
    return rows(data).map(mapRow);
  },

  async submit(
    matchId: string,
    scoreTeam1: number,
    scoreTeam2: number,
  ): Promise<void> {
    const { error } = await supabase.rpc("admin_submit_championship_result", {
      target_match_id: matchId,
      target_score_team1: scoreTeam1,
      target_score_team2: scoreTeam2,
      target_comment: null,
    });
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(error, "Impossible d’enregistrer ce résultat."),
      );
    }
  },
};
