import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
import type {
  TournamentScorePayload,
  TournamentSportingRulesSummary,
} from "@/features/tournaments/components/TournamentScoreEditor";

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

export type AdminTournamentMatchResult = {
  id: string;
  status: "pending_validation" | "validated";
  score: TournamentScorePayload;
  teamASets: number;
  teamBSets: number;
  teamAPoints: number;
  teamBPoints: number;
  teamARankingPoints: number;
  teamBRankingPoints: number;
  submittedAt: string;
  validatedAt: string | null;
};

export type AdminTournamentResultMatch = {
  id: string;
  playDate: string;
  startsAt: string;
  endsAt: string;
  resourceName: string;
  seriesName: string;
  poolNumber: number;
  teamALabel: string;
  teamBLabel: string;
  result: AdminTournamentMatchResult | null;
};

export type AdminTournamentResultsWorkspace = {
  id: string;
  name: string;
  status: string;
  sportingRules: TournamentSportingRulesSummary;
  matches: AdminTournamentResultMatch[];
};

const mapScore = (value: unknown): TournamentScorePayload => {
  const score = (value ?? {}) as Row;
  return {
    sets: rows(score.sets).map((set) => ({
      teamA: Number(set.team_a ?? 0),
      teamB: Number(set.team_b ?? 0),
    })),
  };
};

const mapResult = (value: unknown): AdminTournamentMatchResult | null => {
  if (!value || typeof value !== "object") return null;
  const result = value as Row;
  return {
    id: String(result.id ?? ""),
    status: result.status as AdminTournamentMatchResult["status"],
    score: mapScore(result.score),
    teamASets: Number(result.team_a_sets ?? 0),
    teamBSets: Number(result.team_b_sets ?? 0),
    teamAPoints: Number(result.team_a_points ?? 0),
    teamBPoints: Number(result.team_b_points ?? 0),
    teamARankingPoints: Number(result.team_a_ranking_points ?? 0),
    teamBRankingPoints: Number(result.team_b_ranking_points ?? 0),
    submittedAt: String(result.submitted_at ?? ""),
    validatedAt: result.validated_at ? String(result.validated_at) : null,
  };
};

const mapWorkspace = (row: Row): AdminTournamentResultsWorkspace => {
  const rules = (row.sporting_rules ?? {}) as Row;
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    status: String(row.status ?? ""),
    sportingRules: {
      matchFormat:
        rules.match_format === "single_game"
          ? "single_game"
          : "best_of_three_sets",
      singleGamePoints: Number(rules.single_game_points ?? 35),
      mainSetPoints: Number(rules.main_set_points ?? 20),
      decidingSetPoints: Number(rules.deciding_set_points ?? 10),
    },
    matches: rows(row.matches).map((match) => ({
      id: String(match.id ?? ""),
      playDate: String(match.play_date ?? ""),
      startsAt: String(match.starts_at ?? "").slice(0, 5),
      endsAt: String(match.ends_at ?? "").slice(0, 5),
      resourceName: String(match.resource_name ?? ""),
      seriesName: String(match.series_name ?? ""),
      poolNumber: Number(match.pool_number ?? 0),
      teamALabel: String(match.team_a_label ?? "Équipe A"),
      teamBLabel: String(match.team_b_label ?? "Équipe B"),
      result: mapResult(match.result),
    })),
  };
};

const toRpcScore = (score: TournamentScorePayload) => ({
  sets: score.sets.map((set) => ({
    team_a: set.teamA,
    team_b: set.teamB,
  })),
});

export const tournamentResultsAdminService = {
  async getWorkspace(): Promise<AdminTournamentResultsWorkspace[]> {
    const { data, error } = await supabase.rpc(
      "admin_get_tournament_results_workspace",
    );
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(error, "Impossible de charger les résultats."),
      );
    }
    return rows(data).map(mapWorkspace);
  },

  async validate(matchId: string): Promise<void> {
    const { error } = await supabase.rpc(
      "admin_validate_tournament_match_result",
      { target_match_id: matchId },
    );
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(error, "Validation du résultat impossible."),
      );
    }
  },

  async save(matchId: string, score: TournamentScorePayload): Promise<void> {
    const { error } = await supabase.rpc("admin_save_tournament_match_result", {
      target_match_id: matchId,
      score_payload: toRpcScore(score),
    });
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(error, "Enregistrement du résultat impossible."),
      );
    }
  },
};
