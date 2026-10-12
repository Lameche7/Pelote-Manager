import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

type Row = Record<string, unknown>;
const objects = (data: unknown): Row[] =>
  Array.isArray(data) ? (data as Row[]) : [];
const formatTime = (value: unknown) => String(value ?? "").slice(0, 5);

export type UnprogrammedTournamentMatch = {
  matchId: string;
  tournamentName: string;
  seriesName: string;
  teamA: string;
  teamB: string;
  previousDate: string;
  previousStart: string;
  previousEnd: string;
  reason: string;
  resources: { id: string; name: string }[];
};

export const adminTournamentUnprogrammedService = {
  async list(): Promise<UnprogrammedTournamentMatch[]> {
    const { data, error } = await supabase.rpc(
      "admin_list_unprogrammed_tournament_matches",
    );
    if (error)
      throw new Error(
        getSupabaseErrorMessage(error, "Impossible de charger les parties à programmer."),
      );
    return objects(data).map((row) => ({
      matchId: String(row.match_id ?? ""),
      tournamentName: String(row.tournament_name ?? ""),
      seriesName: String(row.series_name ?? ""),
      teamA: String(row.team_a ?? ""),
      teamB: String(row.team_b ?? ""),
      previousDate: String(row.previous_date ?? ""),
      previousStart: formatTime(row.previous_start),
      previousEnd: formatTime(row.previous_end),
      reason: String(row.reason ?? ""),
      resources: objects(row.resources).map((resource) => ({
        id: String(resource.id ?? ""),
        name: String(resource.name ?? ""),
      })),
    }));
  },
  async unprogram(matchId: string, reason: string): Promise<void> {
    const { error } = await supabase.rpc("admin_unprogram_tournament_match", {
      target_match_id: matchId,
      reason,
    });
    if (error)
      throw new Error(
        getSupabaseErrorMessage(error, "Impossible de libérer ce créneau."),
      );
  },
  async reprogram(input: {
    matchId: string;
    resourceId: string;
    date: string;
    start: string;
    end: string;
  }): Promise<void> {
    const { error } = await supabase.rpc("admin_reprogram_tournament_match", {
      target_match_id: input.matchId,
      target_resource_id: input.resourceId,
      target_play_date: input.date,
      target_starts_at: input.start,
      target_ends_at: input.end,
    });
    if (error)
      throw new Error(
        getSupabaseErrorMessage(error, "Impossible de programmer cette partie."),
      );
  },
};
