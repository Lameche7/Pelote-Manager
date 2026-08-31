import type { ErrebotTournamentParseResult } from "./errebotParser.js";

export type ErrebotIdentityMatchStatus =
  | "verified"
  | "suggested"
  | "conflict"
  | "unmatched";

export type ErrebotIdentityMatchRequest = {
  externalKey: string;
  teamExternalId: string;
  playerIndex: 1 | 2;
  firstName: string;
  lastName: string;
  phone: string;
};

export type ErrebotIdentityMatch = {
  externalKey: string;
  teamExternalId: string;
  playerIndex: number;
  firstName: string;
  lastName: string;
  status: ErrebotIdentityMatchStatus;
  reason: string;
  externalIdentityId: string | null;
  memberId: string | null;
  profileId: string | null;
  memberDisplayName: string | null;
  licenceNumber: string | null;
  clubId: string | null;
  clubName: string | null;
  linkedAccount: boolean;
  memberActive: boolean;
};

export type ErrebotIdentityMatchSummary = Record<
  ErrebotIdentityMatchStatus,
  number
>;

export const buildErrebotIdentityMatchPayload = (
  parsed: ErrebotTournamentParseResult,
): ErrebotIdentityMatchRequest[] =>
  parsed.teams.flatMap((team) =>
    team.players.map((player, index) => ({
      externalKey: `${team.externalId}:${index + 1}`,
      teamExternalId: team.externalId,
      playerIndex: (index + 1) as 1 | 2,
      firstName: player.firstName,
      lastName: player.lastName,
      phone: player.phone,
    })),
  );

export const summarizeErrebotIdentityMatches = (
  matches: ErrebotIdentityMatch[],
): ErrebotIdentityMatchSummary =>
  matches.reduce<ErrebotIdentityMatchSummary>(
    (summary, match) => {
      summary[match.status] += 1;
      return summary;
    },
    { verified: 0, suggested: 0, conflict: 0, unmatched: 0 },
  );

export const errebotIdentityStatusLabel = (
  status: ErrebotIdentityMatchStatus,
) =>
  ({
    verified: "Vérifié",
    suggested: "Suggestion",
    conflict: "À contrôler",
    unmatched: "Non trouvé",
  })[status];

export const errebotIdentityReasonLabel = (reason: string) =>
  ({
    reused_verified_identity:
      "Identité Errebot déjà vérifiée lors d’un précédent tournoi",
    admin_confirmed: "Rapprochement confirmé par un administrateur",
    exact_name_phone: "Nom, prénom et téléphone concordent",
    unique_name: "Un seul licencié porte ce nom et ce prénom",
    inactive_member: "La fiche licencié correspondante est inactive",
    ambiguous_exact: "Plusieurs fiches correspondent exactement",
    name_phone_mismatch: "Le nom correspond mais le téléphone diffère",
    ambiguous_name: "Plusieurs licenciés portent ce nom et ce prénom",
    phone_name_conflict: "Le téléphone existe mais sous une autre identité",
    no_match: "Aucun licencié correspondant n’a été trouvé",
  })[reason] ?? reason;
