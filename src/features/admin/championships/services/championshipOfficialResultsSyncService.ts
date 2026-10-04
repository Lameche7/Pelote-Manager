import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

type Row = Record<string, unknown>;

type ChampionshipRpc = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

const rpc = supabase.rpc.bind(supabase) as unknown as ChampionshipRpc;

export type OfficialChampionshipResult = {
  division: string;
  phase: string;
  poolCode: string | null;
  sourceDate: string | null;
  team1Label: string;
  team2Label: string;
  team1: { clubName: string; teamNumber: string };
  team2: { clubName: string; teamNumber: string };
  scoreRaw: string;
  scoreTeam1: number;
  scoreTeam2: number;
  sourceInfo: string | null;
};

export type OfficialResultsSourceResponse = {
  checkedAt: string;
  checksum: string;
  summary: {
    divisionCount: number;
    officialResultCount: number;
  };
  divisions: Array<{
    division: string;
    declaredCount: number | null;
    loadedCount: number;
    resultCount: number;
  }>;
  results: OfficialChampionshipResult[];
  warnings: string[];
};

export type OfficialResultConflict = {
  division: string;
  team1Label: string;
  team2Label: string;
  proposedScoreTeam1: number;
  proposedScoreTeam2: number;
  officialScoreTeam1: number;
  officialScoreTeam2: number;
};

export type OfficialResultsApplyResponse = {
  processedCount: number;
  updatedCount: number;
  unchangedCount: number;
  issueCount: number;
  issues: Array<Record<string, unknown>>;
  confirmedProposalCount: number;
  conflictProposalCount: number;
  conflicts: OfficialResultConflict[];
};

const sourceError = async (response: Response) => {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (payload.error) return String(payload.error);
  } catch {
    // Ignore malformed error bodies and use the generic message below.
  }
  return "Impossible de lire les résultats officiels FFPB.";
};

const asConflict = (value: unknown): OfficialResultConflict | null => {
  if (!value || typeof value !== "object") return null;
  const row = value as Row;
  const proposed1 = Number(row.proposedScoreTeam1);
  const proposed2 = Number(row.proposedScoreTeam2);
  const official1 = Number(row.officialScoreTeam1);
  const official2 = Number(row.officialScoreTeam2);
  if (![proposed1, proposed2, official1, official2].every(Number.isFinite)) {
    return null;
  }
  return {
    division: String(row.division ?? "Série"),
    team1Label: String(row.team1Label ?? "Équipe 1"),
    team2Label: String(row.team2Label ?? "Équipe 2"),
    proposedScoreTeam1: proposed1,
    proposedScoreTeam2: proposed2,
    officialScoreTeam1: official1,
    officialScoreTeam2: official2,
  };
};

export const championshipOfficialResultsSyncService = {
  async read(params: {
    sourceUrl: string;
    seasonLabel: string;
    competitionName: string;
    specialty: string;
    divisions: string[];
  }): Promise<OfficialResultsSourceResponse> {
    const response = await fetch("/api/championship-results-source", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceUrl: params.sourceUrl,
        seasonLabel: params.seasonLabel,
        competitionName: params.competitionName,
        specialty: params.specialty,
        divisions: params.divisions.map((name) => ({ name })),
      }),
    });

    if (!response.ok) throw new Error(await sourceError(response));
    const payload = (await response.json()) as OfficialResultsSourceResponse;
    if (!payload || !Array.isArray(payload.results)) {
      throw new Error("La réponse de la source officielle est incomplète.");
    }
    return payload;
  },

  async apply(
    championshipId: string,
    results: OfficialChampionshipResult[],
  ): Promise<OfficialResultsApplyResponse> {
    const { data, error } = await rpc(
      "admin_sync_championship_official_results",
      {
        target_id: championshipId,
        payload: results,
      },
    );
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible d’appliquer les résultats officiels.",
        ),
      );
    }
    const row = (data ?? {}) as Row;
    return {
      processedCount: Number(row.processedCount ?? 0),
      updatedCount: Number(row.updatedCount ?? 0),
      unchangedCount: Number(row.unchangedCount ?? 0),
      issueCount: Number(row.issueCount ?? 0),
      issues: Array.isArray(row.issues)
        ? (row.issues as Array<Record<string, unknown>>)
        : [],
      confirmedProposalCount: Number(row.confirmedProposalCount ?? 0),
      conflictProposalCount: Number(row.conflictProposalCount ?? 0),
      conflicts: Array.isArray(row.conflicts)
        ? row.conflicts
            .map(asConflict)
            .filter((conflict): conflict is OfficialResultConflict => Boolean(conflict))
        : [],
    };
  },
};
