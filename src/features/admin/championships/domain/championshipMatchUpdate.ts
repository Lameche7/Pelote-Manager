import {
  parseChampionshipTeamLabel,
  type ChampionshipImportIssue,
  type ChampionshipImportMatch,
} from "./championshipSourceImport.js";
import {
  extractChampionshipSourceExternalId,
  type ChampionshipImportFileDescriptor,
} from "./championshipTransactionalImport.js";

export type ChampionshipMatchesFilePreview = {
  valid: boolean;
  competition: string | null;
  specialty: string | null;
  matches: ChampionshipImportMatch[];
  issues: ChampionshipImportIssue[];
};

export type ChampionshipMatchSnapshot = {
  id: string;
  divisionName: string;
  poolCode: string | null;
  phase: string;
  sourceKey: string;
  team1Label: string;
  team2Label: string;
  scheduledOn: string | null;
  scheduledTime: string | null;
  reportOn: string | null;
  reportTime: string | null;
  venue: string | null;
  agreementOn: string | null;
  agreementTime: string | null;
  agreementVenue: string | null;
  status: string;
  scoreRaw: string | null;
  scoreTeam1: number | null;
  scoreTeam2: number | null;
  resultComment: string | null;
  sourceMetadata: Record<string, string>;
};

export type ChampionshipMatchDiffField = {
  kind: "result" | "schedule" | "venue" | "status" | "metadata";
  label: string;
  before: string;
  after: string;
};

export type ChampionshipMatchDiffItem = {
  identity: string;
  kind: "new" | "updated";
  category: string;
  phase: string;
  team1Label: string;
  team2Label: string;
  fields: ChampionshipMatchDiffField[];
};

export type ChampionshipMatchesUpdatePreview = {
  valid: boolean;
  issues: string[];
  changes: ChampionshipMatchDiffItem[];
  newMatches: number;
  updatedMatches: number;
  resultChanges: number;
  scheduleChanges: number;
  venueChanges: number;
  metadataChanges: number;
  unchangedMatches: number;
  existingMatchesMissingFromFile: number;
};

export type ChampionshipMatchesUpdatePayload = {
  competition: string;
  specialty: string;
  sourceUrl: string | null;
  sourceExternalId: string | null;
  file: ChampionshipImportFileDescriptor;
  matches: Array<{
    category: string;
    phase: string;
    sourceKey: string;
    team1: { clubName: string; teamNumber: string };
    team2: { clubName: string; teamNumber: string };
    scheduledOn: string | null;
    scheduledTime: string | null;
    reportOn: string | null;
    reportTime: string | null;
    venue: string | null;
    agreementOn: string | null;
    agreementTime: string | null;
    agreementVenue: string | null;
    status: string;
    scoreRaw: string | null;
    scoreTeam1: number | null;
    scoreTeam2: number | null;
    resultComment: string | null;
    sourceMetadata: Record<string, string>;
  }>;
};

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();

export const championshipMatchIdentity = (
  category: string,
  phase: string,
  team1Label: string,
  team2Label: string,
) =>
  [category, phase, team1Label, team2Label]
    .map(fold)
    .join("|");

const text = (value: string | number | null | undefined) =>
  value === null || value === undefined || value === "" ? "—" : String(value);

const dateTimeText = (date: string | null, time: string | null) =>
  [date, time].filter(Boolean).join(" ") || "—";

const metadataText = (value: Record<string, string>) =>
  Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${key}:${entry}`)
    .join(" | ");

const duplicateIdentities = (
  rows: Array<{ identity: string }>,
  label: string,
  issues: string[],
) => {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.identity, (counts.get(row.identity) ?? 0) + 1);
  }
  for (const [identity, count] of counts) {
    if (count > 1) {
      issues.push(
        `${label} contient ${count} rencontres impossibles à distinguer automatiquement (${identity}).`,
      );
    }
  }
};

const compareMatch = (
  existing: ChampionshipMatchSnapshot,
  incoming: ChampionshipImportMatch,
) => {
  const fields: ChampionshipMatchDiffField[] = [];

  if (
    existing.scoreRaw !== incoming.scoreRaw ||
    existing.scoreTeam1 !== incoming.scoreTeam1 ||
    existing.scoreTeam2 !== incoming.scoreTeam2 ||
    existing.resultComment !== incoming.resultComment
  ) {
    fields.push({
      kind: "result",
      label: "Résultat",
      before: [text(existing.scoreRaw), text(existing.resultComment)].join(" · "),
      after: [text(incoming.scoreRaw), text(incoming.resultComment)].join(" · "),
    });
  }

  const oldSchedule = [
    dateTimeText(existing.scheduledOn, existing.scheduledTime),
    dateTimeText(existing.reportOn, existing.reportTime),
    dateTimeText(existing.agreementOn, existing.agreementTime),
  ].join(" · ");
  const newSchedule = [
    dateTimeText(incoming.scheduledOn, incoming.scheduledTime),
    dateTimeText(incoming.reportOn, incoming.reportTime),
    dateTimeText(incoming.agreementOn, incoming.agreementTime),
  ].join(" · ");
  if (oldSchedule !== newSchedule) {
    fields.push({
      kind: "schedule",
      label: "Programmation",
      before: oldSchedule,
      after: newSchedule,
    });
  }

  const oldVenue = [text(existing.venue), text(existing.agreementVenue)].join(
    " · ",
  );
  const newVenue = [text(incoming.venue), text(incoming.agreementVenue)].join(
    " · ",
  );
  if (oldVenue !== newVenue) {
    fields.push({
      kind: "venue",
      label: "Lieu",
      before: oldVenue,
      after: newVenue,
    });
  }

  if (existing.status !== incoming.status) {
    fields.push({
      kind: "status",
      label: "Statut",
      before: existing.status,
      after: incoming.status,
    });
  }

  const oldMetadata = metadataText(existing.sourceMetadata);
  const newMetadata = metadataText(incoming.sourceMetadata);
  if (oldMetadata !== newMetadata) {
    fields.push({
      kind: "metadata",
      label: "Informations officielles",
      before: oldMetadata || "—",
      after: newMetadata || "—",
    });
  }

  return fields;
};

export const buildChampionshipMatchesUpdatePreview = (
  championship: {
    name: string;
    specialty: string;
    matches: ChampionshipMatchSnapshot[];
  },
  file: ChampionshipMatchesFilePreview,
): ChampionshipMatchesUpdatePreview => {
  const issues = file.issues
    .filter((issue) => issue.severity === "error")
    .map((issue) => `Ligne ${issue.row || "?"} : ${issue.message}`);

  if (!file.competition || fold(file.competition) !== fold(championship.name)) {
    issues.push("Le fichier ne correspond pas au championnat ouvert.");
  }
  if (!file.specialty || fold(file.specialty) !== fold(championship.specialty)) {
    issues.push("La spécialité du fichier ne correspond pas au championnat ouvert.");
  }

  const existingRows = championship.matches.map((match) => ({
    identity: championshipMatchIdentity(
      match.divisionName,
      match.phase,
      match.team1Label,
      match.team2Label,
    ),
    match,
  }));
  const incomingRows = file.matches.map((match) => ({
    identity: championshipMatchIdentity(
      match.category,
      match.phase,
      match.team1Label,
      match.team2Label,
    ),
    match,
  }));

  duplicateIdentities(existingRows, "Pelote Manager", issues);
  duplicateIdentities(incomingRows, "Le nouveau fichier", issues);

  const existingByIdentity = new Map(
    existingRows.map(({ identity, match }) => [identity, match] as const),
  );
  const incomingIdentitySet = new Set(
    incomingRows.map(({ identity }) => identity),
  );
  const changes: ChampionshipMatchDiffItem[] = [];
  let unchangedMatches = 0;

  for (const { identity, match } of incomingRows) {
    const existing = existingByIdentity.get(identity);
    if (!existing) {
      changes.push({
        identity,
        kind: "new",
        category: match.category,
        phase: match.phase,
        team1Label: match.team1Label,
        team2Label: match.team2Label,
        fields: [],
      });
      continue;
    }
    const fields = compareMatch(existing, match);
    if (fields.length === 0) {
      unchangedMatches += 1;
      continue;
    }
    changes.push({
      identity,
      kind: "updated",
      category: match.category,
      phase: match.phase,
      team1Label: match.team1Label,
      team2Label: match.team2Label,
      fields,
    });
  }

  return {
    valid: issues.length === 0,
    issues,
    changes,
    newMatches: changes.filter((change) => change.kind === "new").length,
    updatedMatches: changes.filter((change) => change.kind === "updated").length,
    resultChanges: changes.filter((change) =>
      change.fields.some((field) => field.kind === "result"),
    ).length,
    scheduleChanges: changes.filter((change) =>
      change.fields.some((field) => field.kind === "schedule"),
    ).length,
    venueChanges: changes.filter((change) =>
      change.fields.some((field) => field.kind === "venue"),
    ).length,
    metadataChanges: changes.filter((change) =>
      change.fields.some((field) => field.kind === "metadata"),
    ).length,
    unchangedMatches,
    existingMatchesMissingFromFile: existingRows.filter(
      ({ identity }) => !incomingIdentitySet.has(identity),
    ).length,
  };
};

export const normalizeChampionshipSourceUrl = (value: string) => {
  const clean = value.trim();
  if (!clean) return null;
  try {
    return new URL(
      /^https?:\/\//iu.test(clean) ? clean : `https://${clean}`,
    ).toString();
  } catch {
    throw new Error("L’URL de la compétition officielle n’est pas valide.");
  }
};

export const buildChampionshipMatchesUpdatePayload = (
  file: ChampionshipMatchesFilePreview,
  descriptor: ChampionshipImportFileDescriptor,
  sourceUrl: string,
): ChampionshipMatchesUpdatePayload => {
  if (!file.valid || !file.competition || !file.specialty) {
    throw new Error("Le fichier des parties n’est pas exploitable.");
  }
  const normalizedSourceUrl = normalizeChampionshipSourceUrl(sourceUrl);

  return {
    competition: file.competition,
    specialty: file.specialty,
    sourceUrl: normalizedSourceUrl,
    sourceExternalId: normalizedSourceUrl
      ? extractChampionshipSourceExternalId(normalizedSourceUrl)
      : null,
    file: descriptor,
    matches: file.matches.map((match) => {
      const team1 = parseChampionshipTeamLabel(match.team1Label);
      const team2 = parseChampionshipTeamLabel(match.team2Label);
      if (!team1 || !team2) {
        throw new Error(`La rencontre de la ligne ${match.row} est invalide.`);
      }
      return {
        category: match.category,
        phase: match.phase,
        sourceKey: match.sourceKey,
        team1,
        team2,
        scheduledOn: match.scheduledOn,
        scheduledTime: match.scheduledTime,
        reportOn: match.reportOn,
        reportTime: match.reportTime,
        venue: match.venue,
        agreementOn: match.agreementOn,
        agreementTime: match.agreementTime,
        agreementVenue: match.agreementVenue,
        status: match.status,
        scoreRaw: match.scoreRaw,
        scoreTeam1: match.scoreTeam1,
        scoreTeam2: match.scoreTeam2,
        resultComment: match.resultComment,
        sourceMetadata: match.sourceMetadata,
      };
    }),
  };
};
