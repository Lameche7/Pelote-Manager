import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];
const nullableString = (value: unknown) =>
  value === null || value === undefined || value === "" ? null : String(value);
const nullableNumber = (value: unknown) =>
  value === null || value === undefined || value === "" ? null : Number(value);

export type MyChampionshipPlayer = {
  firstName: string;
  lastName: string;
  isMe: boolean;
  phone: string | null;
};

export type MyChampionshipContact = {
  firstName: string;
  lastName: string;
  phone: string;
};

export type MyChampionshipStanding = {
  teamId: string;
  teamLabel: string;
  clubName: string;
  teamNumber: string;
  officialRank: number | null;
  officialPoints: number | null;
  statsSource: "official" | "calculated";
  isMyTeam: boolean;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  scoreFor: number;
  scoreAgainst: number;
  scoreDifference: number;
};

export type MyChampionshipResultSubmission = {
  id: string;
  matchId: string;
  teamId: string;
  scoreMine: number;
  scoreOpponent: number;
  status: "pending" | "confirmed_official" | "conflict_official";
  comment: string | null;
  officialScoreMine: number | null;
  officialScoreOpponent: number | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type MyChampionshipMatchReservation = {
  reservationId: string;
  resourceId: string;
  resourceName: string;
  startsAt: string;
  endsAt: string;
  status: string;
};

export type MyChampionshipMatch = {
  id: string;
  phase: string;
  poolCode: string | null;
  teamSide: "a" | "b";
  opponentTeamId: string;
  opponentLabel: string;
  scheduledOn: string | null;
  scheduledTime: string | null;
  reportOn: string | null;
  reportTime: string | null;
  agreementOn: string | null;
  agreementTime: string | null;
  venue: string | null;
  agreementVenue: string | null;
  status: string;
  scoreRaw: string | null;
  scoreMine: number | null;
  scoreOpponent: number | null;
  resultComment: string | null;
  submission: MyChampionshipResultSubmission | null;
  reservation: MyChampionshipMatchReservation | null;
  opponentContacts: MyChampionshipContact[];
};

export type MyChampionship = {
  championshipId: string;
  championshipName: string;
  specialty: string;
  seasonLabel: string;
  championshipStatus: string;
  sourceUrl: string | null;
  divisionId: string;
  divisionName: string;
  poolId: string | null;
  poolCode: string | null;
  poolName: string | null;
  teamId: string;
  teamLabel: string;
  clubName: string;
  officialRank: number | null;
  players: MyChampionshipPlayer[];
  poolStandings: MyChampionshipStanding[];
  matches: MyChampionshipMatch[];
};

const contactKey = (teamId: string, firstName: string, lastName: string) =>
  [
    teamId,
    firstName.trim().toLocaleLowerCase("fr"),
    lastName.trim().toLocaleLowerCase("fr"),
  ].join(":");

const mapSubmission = (row: Row): MyChampionshipResultSubmission => ({
  id: String(row.id ?? ""),
  matchId: String(row.match_id ?? ""),
  teamId: String(row.team_id ?? ""),
  scoreMine: Number(row.score_mine ?? 0),
  scoreOpponent: Number(row.score_opponent ?? 0),
  status:
    row.status === "confirmed_official" || row.status === "conflict_official"
      ? row.status
      : "pending",
  comment: nullableString(row.comment),
  officialScoreMine: nullableNumber(row.official_score_mine),
  officialScoreOpponent: nullableNumber(row.official_score_opponent),
  createdAt: String(row.created_at ?? ""),
  resolvedAt: nullableString(row.resolved_at),
});

const mapChampionship = (row: Row): MyChampionship => ({
  championshipId: String(row.championship_id ?? ""),
  championshipName: String(row.championship_name ?? ""),
  specialty: String(row.specialty ?? ""),
  seasonLabel: String(row.season_label ?? ""),
  championshipStatus: String(row.championship_status ?? ""),
  sourceUrl: nullableString(row.source_url),
  divisionId: String(row.division_id ?? ""),
  divisionName: String(row.division_name ?? ""),
  poolId: nullableString(row.pool_id),
  poolCode: nullableString(row.pool_code),
  poolName: nullableString(row.pool_name),
  teamId: String(row.team_id ?? ""),
  teamLabel: String(row.team_label ?? ""),
  clubName: String(row.club_name ?? ""),
  officialRank: nullableNumber(row.official_rank),
  players: rows(row.players).map((player) => ({
    firstName: String(player.first_name ?? ""),
    lastName: String(player.last_name ?? ""),
    isMe: Boolean(player.is_me),
    phone: null,
  })),
  poolStandings: rows(row.pool_standings).map((standing) => ({
    teamId: String(standing.team_id ?? ""),
    teamLabel: String(standing.team_label ?? ""),
    clubName: String(standing.club_name ?? ""),
    teamNumber: String(standing.team_number ?? ""),
    officialRank: nullableNumber(standing.official_rank),
    officialPoints: nullableNumber(standing.official_points),
    statsSource:
      standing.stats_source === "official" ? "official" : "calculated",
    isMyTeam: Boolean(standing.is_my_team),
    played: Number(standing.played ?? 0),
    wins: Number(standing.wins ?? 0),
    draws: Number(standing.draws ?? 0),
    losses: Number(standing.losses ?? 0),
    scoreFor: Number(standing.score_for ?? 0),
    scoreAgainst: Number(standing.score_against ?? 0),
    scoreDifference: Number(standing.score_difference ?? 0),
  })),
  matches: rows(row.matches).map((match) => ({
    id: String(match.id ?? ""),
    phase: String(match.phase ?? ""),
    poolCode: nullableString(match.pool_code),
    teamSide: match.team_side === "b" ? "b" : "a",
    opponentTeamId: String(match.opponent_team_id ?? ""),
    opponentLabel: String(match.opponent_label ?? ""),
    scheduledOn: nullableString(match.scheduled_on),
    scheduledTime: nullableString(match.scheduled_time),
    reportOn: nullableString(match.report_on),
    reportTime: nullableString(match.report_time),
    agreementOn: nullableString(match.agreement_on),
    agreementTime: nullableString(match.agreement_time),
    venue: nullableString(match.venue),
    agreementVenue: nullableString(match.agreement_venue),
    status: String(match.status ?? "to_schedule"),
    scoreRaw: nullableString(match.score_raw),
    scoreMine: nullableNumber(match.score_mine),
    scoreOpponent: nullableNumber(match.score_opponent),
    resultComment: nullableString(match.result_comment),
    submission: null,
    reservation: null,
    opponentContacts: [],
  })),
});

export const myChampionshipsService = {
  async list(): Promise<MyChampionship[]> {
    const [
      championshipsResult,
      submissionsResult,
      reservationsResult,
      contactsResult,
    ] = await Promise.all([
      supabase.rpc("get_my_championships"),
      supabase.rpc("get_my_championship_result_submissions"),
      supabase.rpc("get_my_championship_match_reservations"),
      supabase.rpc("get_my_championship_player_contacts"),
    ]);

    if (championshipsResult.error) {
      throw new Error(
        getSupabaseErrorMessage(
          championshipsResult.error,
          "Impossible de charger vos championnats.",
        ),
      );
    }
    if (submissionsResult.error) {
      throw new Error(
        getSupabaseErrorMessage(
          submissionsResult.error,
          "Impossible de charger vos résultats proposés.",
        ),
      );
    }
    if (reservationsResult.error) {
      throw new Error(
        getSupabaseErrorMessage(
          reservationsResult.error,
          "Impossible de charger les réservations de vos rencontres.",
        ),
      );
    }

    const phoneByPlayer = new Map<string, string>();
    const contactsByTeam = new Map<string, MyChampionshipContact[]>();
    if (!contactsResult.error) {
      for (const row of rows(contactsResult.data)) {
        const teamId = String(row.team_id ?? "");
        const firstName = String(row.first_name ?? "");
        const lastName = String(row.last_name ?? "");
        const phone = String(row.phone ?? "").trim();
        if (!teamId || !phone) continue;
        phoneByPlayer.set(contactKey(teamId, firstName, lastName), phone);
        const teamContacts = contactsByTeam.get(teamId) ?? [];
        teamContacts.push({ firstName, lastName, phone });
        contactsByTeam.set(teamId, teamContacts);
      }
    }

    const submissions = new Map(
      rows(submissionsResult.data).map((row) => {
        const submission = mapSubmission(row);
        return [submission.matchId, submission] as const;
      }),
    );
    const reservations = new Map(
      rows(reservationsResult.data).map(
        (row) =>
          [
            String(row.match_id ?? ""),
            {
              reservationId: String(row.reservation_id ?? ""),
              resourceId: String(row.resource_id ?? ""),
              resourceName: String(row.resource_name ?? "Terrain"),
              startsAt: String(row.starts_at ?? ""),
              endsAt: String(row.ends_at ?? ""),
              status: String(row.status ?? "confirmed"),
            } satisfies MyChampionshipMatchReservation,
          ] as const,
      ),
    );

    return rows(championshipsResult.data)
      .map(mapChampionship)
      .map((championship) => ({
        ...championship,
        players: championship.players.map((player) => ({
          ...player,
          phone:
            phoneByPlayer.get(
              contactKey(
                championship.teamId,
                player.firstName,
                player.lastName,
              ),
            ) ?? null,
        })),
        matches: championship.matches.map((match) => ({
          ...match,
          submission: submissions.get(match.id) ?? null,
          reservation: reservations.get(match.id) ?? null,
          opponentContacts: contactsByTeam.get(match.opponentTeamId) ?? [],
        })),
      }))
      .filter((item) => item.teamId);
  },

  async submitResult(
    matchId: string,
    scoreMine: number,
    scoreOpponent: number,
    comment: string,
  ): Promise<void> {
    const { error } = await supabase.rpc("submit_my_championship_result", {
      target_match_id: matchId,
      target_score_mine: scoreMine,
      target_score_opponent: scoreOpponent,
      target_comment: comment || null,
    });
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible d’enregistrer votre résultat.",
        ),
      );
    }
  },
};
