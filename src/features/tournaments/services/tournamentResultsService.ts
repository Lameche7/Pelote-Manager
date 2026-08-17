import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

export type PublicTournamentScore = {
  sets: Array<{ teamA: number; teamB: number }>;
};

export type PublicTournamentResultMatch = {
  id: string;
  displayOrder: number;
  teamAId: string;
  teamALabel: string;
  teamBId: string;
  teamBLabel: string;
  playDate: string;
  startsAt: string;
  endsAt: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  resourceName: string;
  resultStatus: "pending_validation" | "validated" | null;
  score: PublicTournamentScore | null;
  teamASets: number | null;
  teamBSets: number | null;
};

export type PublicTournamentResultPool = {
  id: string;
  number: number;
  matches: PublicTournamentResultMatch[];
};

export type PublicTournamentResultSeries = {
  id: string;
  name: string;
  color: string;
  displayOrder: number;
  pools: PublicTournamentResultPool[];
};

export type PublicTournamentResults = {
  tournamentId: string;
  tournamentName: string;
  status: string;
  series: PublicTournamentResultSeries[];
};

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

const mapScore = (value: unknown): PublicTournamentScore | null => {
  if (!value || typeof value !== "object") return null;
  const score = value as Row;
  return {
    sets: rows(score.sets).map((set) => ({
      teamA: Number(set.team_a ?? 0),
      teamB: Number(set.team_b ?? 0),
    })),
  };
};

const mapResults = (value: unknown): PublicTournamentResults | null => {
  if (!value || typeof value !== "object") return null;
  const root = value as Row;
  return {
    tournamentId: String(root.tournament_id ?? ""),
    tournamentName: String(root.tournament_name ?? ""),
    status: String(root.status ?? ""),
    series: rows(root.series).map((series) => ({
      id: String(series.id ?? ""),
      name: String(series.name ?? "Série"),
      color: String(series.color ?? "#2563EB"),
      displayOrder: Number(series.display_order ?? 0),
      pools: rows(series.pools).map((pool) => ({
        id: String(pool.id ?? ""),
        number: Number(pool.number ?? 0),
        matches: rows(pool.matches).map((match) => ({
          id: String(match.id ?? ""),
          displayOrder: Number(match.display_order ?? 0),
          teamAId: String(match.team_a_id ?? ""),
          teamALabel: String(match.team_a_label ?? "Équipe A"),
          teamBId: String(match.team_b_id ?? ""),
          teamBLabel: String(match.team_b_label ?? "Équipe B"),
          playDate: String(match.play_date ?? ""),
          startsAt: String(match.starts_at ?? "").slice(0, 5),
          endsAt: String(match.ends_at ?? "").slice(0, 5),
          scheduledStartAt: String(match.scheduled_start_at ?? ""),
          scheduledEndAt: String(match.scheduled_end_at ?? ""),
          resourceName: String(match.resource_name ?? ""),
          resultStatus:
            match.result_status === "validated" ||
            match.result_status === "pending_validation"
              ? match.result_status
              : null,
          score: mapScore(match.score),
          teamASets:
            match.team_a_sets === null || match.team_a_sets === undefined
              ? null
              : Number(match.team_a_sets),
          teamBSets:
            match.team_b_sets === null || match.team_b_sets === undefined
              ? null
              : Number(match.team_b_sets),
        })),
      })),
    })),
  };
};

export const tournamentResultsService = {
  async get(tournamentId: string): Promise<PublicTournamentResults | null> {
    const { data, error } = await supabase.rpc(
      "get_public_tournament_results",
      {
        target_tournament_id: tournamentId,
      },
    );
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de charger les résultats du tournoi.",
        ),
      );
    }
    return mapResults(data);
  },
};
