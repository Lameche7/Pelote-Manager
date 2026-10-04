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

export type OfficialResultsApplyResponse = {
  processedCount: number;
  updatedCount: number;
  unchangedCount: number;
  issueCount: number;
  issues: Array<Record<string, unknown>>;
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
    };
  },
};
