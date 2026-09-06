import {
  parseChampionshipTeamLabel,
  type ChampionshipImportIssue,
  type ChampionshipImportMatch,
} from "./championshipSourceImport.js";

export type ChampionshipMatchesUpdateRow = {
  category: string;
  phase: string;
  sourceKey: string;
  occurrence: number;
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
};

export type ChampionshipMatchesUpdatePreviewFile = {
  competition: string | null;
  specialty: string | null;
  matches: ChampionshipImportMatch[];
  issues: ChampionshipImportIssue[];
  valid: boolean;
};

export type ChampionshipMatchesUpdateFileDescriptor = {
  kind: "matches";
  fileName: string;
  checksum: string;
  rowCount: number;
};

export type ChampionshipMatchesUpdatePayload = {
  competition: string;
  specialty: string;
  file: ChampionshipMatchesUpdateFileDescriptor;
  matches: ChampionshipMatchesUpdateRow[];
};

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();

const naturalMatchKey = (match: ChampionshipImportMatch) =>
  [
    fold(match.category),
    fold(match.phase),
    fold(match.team1Label),
    fold(match.team2Label),
  ].join("|");

export const buildChampionshipMatchesUpdateRows = (
  matches: ChampionshipImportMatch[],
): ChampionshipMatchesUpdateRow[] => {
  const occurrences = new Map<string, number>();

  return matches.map((match) => {
    const team1 = parseChampionshipTeamLabel(match.team1Label);
    const team2 = parseChampionshipTeamLabel(match.team2Label);
    if (!team1 || !team2) {
      throw new Error(
        `Une équipe de la ligne ${match.row} n’est pas exploitable.`,
      );
    }

    const naturalKey = naturalMatchKey(match);
    const occurrence = (occurrences.get(naturalKey) ?? 0) + 1;
    occurrences.set(naturalKey, occurrence);

    return {
      category: match.category,
      phase: match.phase,
      sourceKey: match.sourceKey,
      occurrence,
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
  });
};

export const buildChampionshipMatchesUpdatePayload = (
  preview: ChampionshipMatchesUpdatePreviewFile,
  file: ChampionshipMatchesUpdateFileDescriptor,
): ChampionshipMatchesUpdatePayload => {
  if (!preview.valid || !preview.competition || !preview.specialty) {
    throw new Error("Le fichier des parties n’est pas exploitable.");
  }

  return {
    competition: preview.competition,
    specialty: preview.specialty,
    file,
    matches: buildChampionshipMatchesUpdateRows(preview.matches),
  };
};
