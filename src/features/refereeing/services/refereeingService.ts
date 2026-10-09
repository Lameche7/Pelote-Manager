import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
export type RefereeingMatch = {
  match_id: string;
  club_id: string;
  source_type: "championship" | "tournament";
  competition_label: string;
  team1_label: string;
  team2_label: string;
  play_date: string | null;
  play_time: string | null;
  venue: string | null;
  referee_profile_id: string | null;
  referee_name: string | null;
  is_mine: boolean;
  my_count: number;
};
export type RefereeCandidate = { id: string; name: string; count: number };
export type RefereeingParticipation = {
  member_id: string;
  player_name: string;
  arbitration_count: number;
  total_licensed: number;
  different_referees: number;
};
export const refereeingService = {
  async list(): Promise<RefereeingMatch[]> {
    const { data, error } = await supabase.rpc("get_refereeing_workspace");
    if (error)
      throw new Error(
        getSupabaseErrorMessage(error, "Impossible de charger les arbitrages."),
      );
    const base = Array.isArray(data) ? (data as RefereeingMatch[]) : [];
    return base.sort((a, b) =>
      `${a.play_date ?? "9999"} ${a.play_time ?? ""}`.localeCompare(
        `${b.play_date ?? "9999"} ${b.play_time ?? ""}`,
      ),
    );
  },
  async submitChampionshipScore(
    matchId: string,
    scoreTeam1: number,
    scoreTeam2: number,
  ) {
    const { error } = await supabase.rpc("referee_submit_championship_result", {
      target_match_id: matchId,
      target_score_team1: scoreTeam1,
      target_score_team2: scoreTeam2,
    });
    if (error)
      throw new Error(
        getSupabaseErrorMessage(error, "Impossible d'enregistrer le résultat."),
      );
  },
  async tournamentRules(matchId: string) {
    const { data, error } = await supabase.rpc(
      "get_referee_tournament_score_context",
      { target_match_id: matchId },
    );
    if (error)
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de charger les règles du tournoi.",
        ),
      );
    return data as {
      match_format: "single_game" | "best_of_three_sets";
      single_game_points: number;
      main_set_points: number;
      deciding_set_points: number;
      ends_at: string;
      has_result: boolean;
    };
  },
  async submitTournamentScore(
    matchId: string,
    sets: { teamA: number; teamB: number }[],
  ) {
    const { error } = await supabase.rpc("referee_submit_tournament_result", {
      target_match_id: matchId,
      score_payload: {
        sets: sets.map((s) => ({ team_a: s.teamA, team_b: s.teamB })),
      },
    });
    if (error)
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible d'enregistrer le résultat du tournoi.",
        ),
      );
  },
  async volunteer(match: RefereeingMatch) {
    const { error } = await supabase.rpc("volunteer_for_refereeing", {
      target_source_type: match.source_type,
      target_match_id: match.match_id,
    });
    if (error)
      throw new Error(
        getSupabaseErrorMessage(error, "Impossible de prendre cet arbitrage."),
      );
  },
  async withdraw(match: RefereeingMatch) {
    const { error } = await supabase.rpc("withdraw_from_refereeing", {
      target_source_type: match.source_type,
      target_match_id: match.match_id,
    });
    if (error)
      throw new Error(
        getSupabaseErrorMessage(error, "Impossible de retirer cet arbitrage."),
      );
  },
  async participation(): Promise<RefereeingParticipation[]> {
    const { data, error } = await supabase.rpc("list_refereeing_participation");
    if (error)
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de charger les statistiques d’arbitrage.",
        ),
      );
    return Array.isArray(data) ? (data as RefereeingParticipation[]) : [];
  },
  async candidates(): Promise<RefereeCandidate[]> {
    const { data, error } = await supabase.rpc("list_referee_candidates");
    if (error)
      throw new Error(
        getSupabaseErrorMessage(error, "Impossible de charger les arbitres."),
      );
    return Array.isArray(data) ? (data as RefereeCandidate[]) : [];
  },
  async assign(match: RefereeingMatch, profileId: string | null) {
    const { error } = await supabase.rpc("admin_set_referee", {
      target_source_type: match.source_type,
      target_match_id: match.match_id,
      target_profile_id: profileId,
    });
    if (error)
      throw new Error(
        getSupabaseErrorMessage(error, "Impossible d’affecter cet arbitre."),
      );
  },
  async alertMembers(missingCount: number): Promise<void> {
    const body = `Attention : ${missingCount} partie${missingCount > 1 ? "s" : ""} à venir ${missingCount > 1 ? "sont" : "est"} encore sans arbitre. Consultez l’espace Arbitrage pour vous positionner.`;
    const { data: id, error: saveError } = await supabase.rpc(
      "admin_save_communication",
      {
        payload: {
          title: "Arbitrage — parties à pourvoir",
          body,
          priority: "important",
          show_on_home: true,
        },
      },
    );
    if (saveError)
      throw new Error(
        getSupabaseErrorMessage(
          saveError,
          "Impossible de préparer la notification.",
        ),
      );
    const { error: publishError } = await supabase.rpc(
      "admin_publish_communication",
      { target_id: id },
    );
    if (publishError)
      throw new Error(
        getSupabaseErrorMessage(
          publishError,
          "Impossible d’envoyer la notification.",
        ),
      );
  },
};
