import {
  parseChampionshipTeamLabel,
  type ChampionshipImportPreview,
} from "./championshipSourceImport.js";

export type ChampionshipImportFileDescriptor = {
  kind: "matches" | "engagements";
  fileName: string;
  checksum: string;
  rowCount: number;
};

export type ChampionshipTransactionalImportPayload = {
  championship: {
    name: string;
    specialty: string;
    seasonLabel: string;
    sourceProvider: "ffpb";
    sourceExternalId: string | null;
    sourceUrl: string | null;
  };
  localFederationClubName: string;
  files: ChampionshipImportFileDescriptor[];
  engagements: Array<{
    category: string;
    poolCode: string | null;
    sourceRank: number | null;
    teamLabel: string;
    clubName: string;
    teamNumber: string;
    players: Array<{
      licenceNumber: string;
      firstName: string;
      lastName: string;
      normalizedFirstName: string;
      normalizedLastName: string;
      sourceEntry: string;
      sourceFlags: string[];
    }>;
  }>;
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

export type ChampionshipTransactionalImportResult = {
  championshipId: string;
  batchId: string;
  alreadyImported: boolean;
  summary: {
    divisionCount: number;
    poolCount: number;
    clubCount: number;
    teamCount: number;
    playerCount: number;
    matchCount: number;
    linkedPlayerCount: number;
  };
};

export const extractChampionshipSourceExternalId = (value: string) => {
  const clean = value.trim();
  if (!clean) return null;
  try {
    const url = new URL(
      /^https?:\/\//iu.test(clean) ? clean : `https://${clean}`,
    );
    const host = url.hostname.toLowerCase();
    const fromQuery = url.searchParams.get("id_competition")?.trim();
    if (fromQuery) return `${host}:competition:${fromQuery}`;

    const routeIdentity = `${url.pathname}${url.search}`.replace(
      /^\/+|\/+$/gu,
      "",
    );
    return routeIdentity ? `${host}:${routeIdentity}` : host;
  } catch {
    return null;
  }
};

export const inferChampionshipSeasonLabel = (competition: string) => {
  const match = competition.match(
    /\b(20\d{2})(?:\s*[-/]\s*(20\d{2}|\d{2}))?\b/u,
  );
  if (!match) return "";
  if (!match[2]) return match[1];
  const end =
    match[2].length === 2 ? `${match[1].slice(0, 2)}${match[2]}` : match[2];
  return `${match[1]}-${end}`;
};

export const buildChampionshipTransactionalImportPayload = (
  preview: ChampionshipImportPreview,
  options: {
    sourceUrl: string;
    localFederationClubName: string;
    files: ChampionshipImportFileDescriptor[];
  },
): ChampionshipTransactionalImportPayload => {
  if (!preview.valid || !preview.competition || !preview.specialty) {
    throw new Error("La prévisualisation du championnat n’est pas valide.");
  }
  if (!preview.federationClubs.includes(options.localFederationClubName)) {
    throw new Error(
      "Le club officiel sélectionné n’existe pas dans cet import.",
    );
  }

  return {
    championship: {
      name: preview.competition,
      specialty: preview.specialty,
      seasonLabel: inferChampionshipSeasonLabel(preview.competition),
      sourceProvider: "ffpb",
      sourceExternalId: extractChampionshipSourceExternalId(options.sourceUrl),
      sourceUrl: options.sourceUrl.trim() || null,
    },
    localFederationClubName: options.localFederationClubName,
    files: options.files,
    engagements: preview.engagements.map((engagement) => ({
      category: engagement.category,
      poolCode: engagement.poolCode,
      sourceRank: engagement.sourceRank,
      teamLabel: engagement.teamLabel,
      clubName: engagement.clubName,
      teamNumber: engagement.teamNumber,
      players: engagement.players,
    })),
    matches: preview.matches.map((match) => {
      const team1 = parseChampionshipTeamLabel(match.team1Label);
      const team2 = parseChampionshipTeamLabel(match.team2Label);
      if (!team1 || !team2) {
        throw new Error(
          `Une équipe de la ligne ${match.row} n’est pas exploitable.`,
        );
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
