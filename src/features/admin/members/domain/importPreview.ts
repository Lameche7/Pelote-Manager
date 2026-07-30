import {
  findFileDuplicates,
  sameIdentity,
  type ParsedMemberRow,
} from "./csvImport.js";

export type ExistingMember = ParsedMemberRow & {
  id: string;
  clubId: string;
  isActive: boolean;
  updatedAt: string;
};
export type PreviewAction =
  | "create"
  | "update"
  | "unchanged"
  | "inactive"
  | "other_club"
  | "duplicate"
  | "identity_conflict"
  | "sensitive_warning"
  | "error"
  | "ignored";
export type ImportPreviewRow = {
  lineNumber: number;
  data: ParsedMemberRow;
  action: PreviewAction;
  errors: string[];
  warnings: string[];
  existing?: ExistingMember;
  ignored: boolean;
  confirmedSensitive: boolean;
  reactivate: boolean;
};

export function buildImportPreview(
  rows: ParsedMemberRow[],
  existing: ExistingMember[],
  clubId: string,
): ImportPreviewRow[] {
  const duplicates = findFileDuplicates(rows);
  return rows.map((data, index) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const found = existing.find(
      (member) => member.licenceNumber === data.licenceNumber,
    );
    if (!data.licenceNumber)
      errors.push("Le numéro de licence est obligatoire.");
    if (!data.lastName || !data.firstName)
      errors.push("Le nom et le prénom sont obligatoires.");
    if (!data.birthDate) errors.push("La date de naissance est invalide.");
    if (!data.gender) errors.push("Le sexe est invalide.");
    let action: PreviewAction = errors.length ? "error" : "create";
    if (duplicates.has(index)) {
      errors.push("Cette licence apparaît plusieurs fois dans le fichier.");
      action = "duplicate";
    } else if (found?.clubId !== undefined && found.clubId !== clubId) {
      errors.push("Cette licence appartient à un autre club.");
      action = "other_club";
    } else if (found) {
      const identityChanges = !sameIdentity(data, found);
      const sensitive =
        data.birthDate !== found.birthDate || data.gender !== found.gender;
      if (
        identityChanges &&
        data.lastName !== found.lastName &&
        data.firstName !== found.firstName &&
        data.birthDate !== found.birthDate
      ) {
        errors.push("L’identité complète diffère de la fiche existante.");
        action = "identity_conflict";
      } else if (sensitive) {
        warnings.push(
          "La naissance ou le sexe diffère : une confirmation est requise.",
        );
        action = "sensitive_warning";
      } else if (!found.isActive) action = "inactive";
      else
        action =
          JSON.stringify(data) ===
          JSON.stringify({
            ...found,
            id: undefined,
            clubId: undefined,
            isActive: undefined,
            updatedAt: undefined,
          })
            ? "unchanged"
            : "update";
    }
    return {
      lineNumber: index + 2,
      data,
      action,
      errors,
      warnings,
      existing: found,
      ignored: false,
      confirmedSensitive: false,
      reactivate: false,
    };
  });
}
export function summarizePreview(rows: ImportPreviewRow[]) {
  return rows.reduce(
    (summary, row) => {
      summary[row.action]++;
      if (row.errors.length) summary.errors++;
      if (row.warnings.length) summary.warnings++;
      return summary;
    },
    {
      create: 0,
      update: 0,
      unchanged: 0,
      inactive: 0,
      other_club: 0,
      duplicate: 0,
      identity_conflict: 0,
      sensitive_warning: 0,
      error: 0,
      ignored: 0,
      errors: 0,
      warnings: 0,
    } as Record<PreviewAction | "errors" | "warnings", number>,
  );
}
export function mergeNonEmpty<T extends Record<string, string | null>>(
  current: T,
  incoming: Partial<T>,
): T {
  return Object.fromEntries(
    Object.entries(current).map(([key, value]) => [
      key,
      incoming[key] === "" || incoming[key] == null ? value : incoming[key],
    ]),
  ) as T;
}
