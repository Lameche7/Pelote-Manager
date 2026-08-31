import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
import type {
  ErrebotIdentityMatch,
  ErrebotIdentityMatchRequest,
  ErrebotIdentityMatchStatus,
} from "../domain/errebotIdentityMatching";

type Row = Record<string, unknown>;

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

export const errebotImportService = {
  async previewIdentityMatches(
    payload: ErrebotIdentityMatchRequest[],
  ): Promise<ErrebotIdentityMatch[]> {
    const { data, error } = await supabase.rpc(
      "admin_preview_errebot_identity_matches",
      { payload },
    );
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible d’analyser les rapprochements de joueurs Errebot.",
        ),
      );
    }
    if (!Array.isArray(data)) {
      throw new Error("Réponse de rapprochement Errebot invalide.");
    }
    return data.map(mapMatch);
  },
};
