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

export type OfficialChampionshipStanding = {
  row: number;
  division: string;
  divisionNormalized: string;
  poolCode: string;
  teamLabel: string;
  clubName: string;
  clubNormalized: string;
  teamNumber: string;
  rank: number;
  played: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  points: number | null;
  scoreFor: number | null;
  scoreAgainst: number | null;
  scoreDifference: number | null;
  sourcePayload: Record<string, string>;
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
  standingsSummary?: {
    divisionCount: number;
    poolCount: number;
    teamCount: number;
  };
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
  standingsUpdatedCount: number;
  standingsUnchangedCount: number;
  standingsIssueCount: number;
};

type OfficialStandingsSourceResponse = {
  standings: OfficialChampionshipStanding[];
  warnings: string[];
  summary: {
    divisionCount: number;
    poolCount: number;
    teamCount: number;
  };
};

const standingsByResults = new WeakMap<
  OfficialChampionshipResult[],
  OfficialChampionshipStanding[]
>();

const sourceError = async (response: Response) => {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (payload.error) return String(payload.error);
  } catch {
    // Ignore malformed error bodies and use the generic message below.
  }
  return "Impossible de lire les résultats officiels FFPB.";
};

const standingsSourceError = async (response: Response) => {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (payload.error) return String(payload.error);
  } catch {
    // Ignore malformed error bodies and use the generic message below.
  }
  return "Impossible de lire les classements officiels FFPB.";
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

const readStandings = async (params: {
  sourceUrl: string;
  seasonLabel: string;
  competitionName: string;
  specialty: string;
  divisions: string[];
}): Promise<OfficialStandingsSourceResponse> => {
  const response = await fetch("/api/championship-pool-standings-source", {
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

  if (!response.ok) throw new Error(await standingsSourceError(response));
  const payload = (await response.json()) as OfficialStandingsSourceResponse;
  if (!payload || !Array.isArray(payload.standings)) {
    throw new Error("La réponse des classements officiels est incomplète.");
  }
  return payload;
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

    payload.warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
    try {
      const standings = await readStandings(params);
      standingsByResults.set(payload.results, standings.standings);
      payload.standingsSummary = standings.summary;
      payload.warnings.push(...(standings.warnings ?? []));
    } catch (cause) {
      standingsByResults.set(payload.results, []);
      payload.warnings.push(
        cause instanceof Error
          ? `Classements : ${cause.message}`
          : "Classements : synchronisation impossible.",
      );
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
    let standingsUpdatedCount = 0;
    let standingsUnchangedCount = 0;
    let standingsIssueCount = 0;
    const standingsIssues: Array<Record<string, unknown>> = [];
    const standings = standingsByResults.get(results) ?? [];

    if (standings.length > 0) {
      const standingsRpc = await rpc(
        "admin_sync_championship_official_standings",
        {
          target_id: championshipId,
          payload: standings,
        },
      );
      if (standingsRpc.error) {
        standingsIssueCount = 1;
        standingsIssues.push({
          code: "standings_sync_failed",
          message: getSupabaseErrorMessage(
            standingsRpc.error,
            "Impossible d’appliquer les classements officiels.",
          ),
        });
      } else {
        const standingsRow = (standingsRpc.data ?? {}) as Row;
        standingsUpdatedCount = Number(standingsRow.updatedCount ?? 0);
        standingsUnchangedCount = Number(standingsRow.unchangedCount ?? 0);
        standingsIssueCount = Number(standingsRow.issueCount ?? 0);
        if (Array.isArray(standingsRow.issues)) {
          standingsIssues.push(
            ...(standingsRow.issues as Array<Record<string, unknown>>),
          );
        }
      }
    }

    const resultIssues = Array.isArray(row.issues)
      ? (row.issues as Array<Record<string, unknown>>)
      : [];

    return {
      processedCount: Number(row.processedCount ?? 0),
      updatedCount: Number(row.updatedCount ?? 0),
      unchangedCount: Number(row.unchangedCount ?? 0),
      issueCount: Number(row.issueCount ?? 0) + standingsIssueCount,
      issues: [...resultIssues, ...standingsIssues],
      confirmedProposalCount: Number(row.confirmedProposalCount ?? 0),
      conflictProposalCount: Number(row.conflictProposalCount ?? 0),
      conflicts: Array.isArray(row.conflicts)
        ? row.conflicts
            .map(asConflict)
            .filter((conflict): conflict is OfficialResultConflict => Boolean(conflict))
        : [],
      standingsUpdatedCount,
      standingsUnchangedCount,
      standingsIssueCount,
    };
  },
};
