import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
import type {
  ErrebotIdentityMatch,
  ErrebotIdentityMatchRequest,
  ErrebotIdentityMatchStatus,
} from "../domain/errebotIdentityMatching";
import type {
  ErrebotTournamentImportPayload,
  ErrebotTournamentImportResult,
} from "../domain/errebotTransactionalImport";

type Row = Record<string, unknown>;

export type ErrebotIdentityCandidate = {
  id: string;
  displayName: string;
  licenceNumber: string | null;
  clubName: string | null;
  linkedAccount: boolean;
  memberActive: boolean;
};

const statuses = new Set<ErrebotIdentityMatchStatus>([
  "verified",
  "suggested",
  "conflict",
  "unmatched",
]);

const nullableString = (value: unknown) =>
  value === null || value === undefined || value === "" ? null : String(value);

const mapMatch = (value: unknown): ErrebotIdentityMatch => {
  const row = (value ?? {}) as Row;
  const status = String(
    row.status ?? "unmatched",
  ) as ErrebotIdentityMatchStatus;
  if (!statuses.has(status)) {
    throw new Error("Statut de rapprochement Errebot invalide.");
  }
  return {
    externalKey: String(row.externalKey ?? ""),
    teamExternalId: String(row.teamExternalId ?? ""),
    playerIndex: Number(row.playerIndex ?? 0),
    firstName: String(row.firstName ?? ""),
    lastName: String(row.lastName ?? ""),
    status,
    reason: String(row.reason ?? ""),
    externalIdentityId: nullableString(row.externalIdentityId),
    memberId: nullableString(row.memberId),
    profileId: nullableString(row.profileId),
    memberDisplayName: nullableString(row.memberDisplayName),
    licenceNumber: nullableString(row.licenceNumber),
    clubId: nullableString(row.clubId),
    clubName: nullableString(row.clubName),
    linkedAccount: Boolean(row.linkedAccount),
    memberActive: Boolean(row.memberActive),
  };
};

const mapCandidate = (value: unknown): ErrebotIdentityCandidate => {
  const row = (value ?? {}) as Row;
  return {
    id: String(row.id ?? ""),
    displayName: String(row.displayName ?? ""),
    licenceNumber: nullableString(row.licenceNumber),
    clubName: nullableString(row.clubName),
    linkedAccount: Boolean(row.linkedAccount),
    memberActive: Boolean(row.memberActive),
  };
};

const mapImportResult = (value: unknown): ErrebotTournamentImportResult => {
  const row = (value ?? {}) as Row;
  const summary = (row.summary ?? {}) as Row;
  const matchFormat = row.matchFormat;
  const result: ErrebotTournamentImportResult = {
    importId: String(row.importId ?? ""),
    tournamentId: String(row.tournamentId ?? ""),
    alreadyImported: Boolean(row.alreadyImported),
    optionsApplied:
      row.optionsApplied === undefined ? undefined : Boolean(row.optionsApplied),
    primaryResourceId: nullableString(row.primaryResourceId) ?? undefined,
    resourceCount:
      row.resourceCount === undefined ? undefined : Number(row.resourceCount),
    matchFormat:
      matchFormat === "single_game" || matchFormat === "best_of_three_sets"
        ? matchFormat
        : undefined,
    slotDurationMinutes:
      row.slotDurationMinutes === undefined
        ? undefined
        : Number(row.slotDurationMinutes),
    summary: {
      teamCount: Number(summary.teamCount ?? 0),
      poolCount: Number(summary.poolCount ?? 0),
      matchCount: Number(summary.matchCount ?? 0),
      verifiedPlayerCount:
        summary.verifiedPlayerCount === undefined
          ? undefined
          : Number(summary.verifiedPlayerCount),
      externalPlayerCount:
        summary.externalPlayerCount === undefined
          ? undefined
          : Number(summary.externalPlayerCount),
      sourceScoreCount:
        summary.sourceScoreCount === undefined
          ? undefined
          : Number(summary.sourceScoreCount),
    },
  };

  if (!result.importId || !result.tournamentId) {
    throw new Error("Réponse d’import Errebot invalide.");
  }
  return result;
};

const fail = (error: unknown, fallback: string): never => {
  throw new Error(getSupabaseErrorMessage(error, fallback));
};

export const errebotImportService = {
  async previewIdentityMatches(
    payload: ErrebotIdentityMatchRequest[],
  ): Promise<ErrebotIdentityMatch[]> {
    const { data, error } = await supabase.rpc(
      "admin_preview_errebot_identity_matches",
      { payload },
    );
    if (error) fail(error, "Impossible d’analyser les rapprochements Errebot.");
    if (!Array.isArray(data)) {
      throw new Error("Réponse de rapprochement Errebot invalide.");
    }
    return data.map(mapMatch);
  },

  async searchIdentityCandidates(
    searchText: string,
  ): Promise<ErrebotIdentityCandidate[]> {
    const { data, error } = await supabase.rpc(
      "admin_search_errebot_identity_candidates",
      { search_text: searchText.trim() },
    );
    if (error) fail(error, "Impossible de rechercher les licenciés.");
    if (!Array.isArray(data)) return [];
    return data.map(mapCandidate).filter((candidate) => candidate.id);
  },

  async confirmIdentityMatch(
    request: ErrebotIdentityMatchRequest,
    memberId: string,
  ): Promise<ErrebotIdentityMatch> {
    const { data, error } = await supabase.rpc(
      "admin_confirm_errebot_identity_match",
      {
        payload: {
          ...request,
          memberId,
        },
      },
    );
    if (error) fail(error, "Impossible de confirmer ce rapprochement.");
    return mapMatch(data);
  },

  async importTournament(
    payload: ErrebotTournamentImportPayload,
  ): Promise<ErrebotTournamentImportResult> {
    const { data, error } = await supabase.rpc(
      "admin_import_errebot_tournament_configured",
      { payload },
    );
    if (error) fail(error, "Impossible d’importer le tournoi Errebot.");
    return mapImportResult(data);
  },
};
