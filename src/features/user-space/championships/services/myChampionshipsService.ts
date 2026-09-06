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
};

export type MyChampionshipStanding = {
  teamId: string;
  teamLabel: string;
  clubName: string;
  teamNumber: string;
  officialRank: number | null;
  isMyTeam: boolean;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  scoreFor: number;
  scoreAgainst: number;
  scoreDifference: number;
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
  })),
  poolStandings: rows(row.pool_standings).map((standing) => ({
    teamId: String(standing.team_id ?? ""),
    teamLabel: String(standing.team_label ?? ""),
    clubName: String(standing.club_name ?? ""),
    teamNumber: String(standing.team_number ?? ""),
    officialRank: nullableNumber(standing.official_rank),
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
  })),
});

export const myChampionshipsService = {
  async list(): Promise<MyChampionship[]> {
    const { data, error } = await supabase.rpc("get_my_championships");
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de charger vos championnats.",
        ),
      );
    }
    return rows(data)
      .map(mapChampionship)
      .filter((item) => item.teamId);
  },
};
