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

type SupabaseLikeError = {
  message?: string;
  code?: string;
};

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
      row.optionsApplied === undefined
        ? undefined
        : Boolean(row.optionsApplied),
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

const importErrors: Record<string, string> = {
  "Errebot import payload is invalid":
    "Les données structurées du fichier Errebot sont incomplètes ou invalides.",
  "Errebot import season is invalid":
    "La saison sélectionnée n’est plus disponible pour ce club.",
  "Errebot import resource is invalid":
    "Le terrain principal sélectionné n’est plus disponible.",
  "Errebot series are invalid":
    "Les séries extraites du fichier Errebot sont incohérentes.",
  "Errebot teams are invalid":
    "Une ou plusieurs équipes Errebot sont incomplètes ou incohérentes.",
  "Errebot pool assignments are invalid":
    "La répartition des équipes dans les poules Errebot est incohérente.",
  "Errebot fixtures are invalid":
    "Le calendrier Errebot ne correspond pas exactement aux poules importées.",
  "Errebot tournament dates do not fit inside the selected season":
    "Les dates du tournoi ne sont pas entièrement comprises dans la saison sélectionnée.",
  "Errebot fixture duration crosses midnight":
    "La durée choisie ferait terminer au moins une partie après minuit.",
  "Errebot tournament resources are invalid":
    "Vérifiez les terrains sélectionnés, le terrain principal et la durée des créneaux.",
  "Errebot tournament sporting rules are invalid":
    "Vérifiez le format de score et les règles de classement du tournoi.",
  "Errebot import returned no tournament":
    "L’import Errebot n’a pas renvoyé de tournoi exploitable.",
  "Tournament is not an imported Errebot tournament":
    "Le tournoi existant n’est plus relié à cet import Errebot.",
  "Imported Errebot tournament options are locked after publication":
    "Ce tournoi Errebot a déjà dépassé l’étape de planning modifiable. Retirez d’abord son planning du calendrier avant de corriger ses options.",
  "This Errebot file already has an unfinished import":
    "Ce fichier Errebot possède déjà un import incomplet. Il faut terminer ou corriger cet import avant de recommencer.",
  "Tournament name already exists":
    "Un tournoi portant déjà ce nom existe dans la saison sélectionnée.",
};

const fail = (error: unknown, fallback: string): never => {
  if (error && typeof error === "object") {
    const { message = "", code = "" } = error as SupabaseLikeError;
    const knownMessage = importErrors[message];
    if (knownMessage) throw new Error(knownMessage);

    if (
      code === "PGRST202" ||
      (message.includes("admin_import_errebot_tournament_configured") &&
        message.toLowerCase().includes("function"))
    ) {
      throw new Error(
        "La fonction d’import configuré n’est pas encore disponible dans Supabase. Appliquez la migration 20260901154500 puis rechargez le schéma PostgREST.",
      );
    }
  }

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