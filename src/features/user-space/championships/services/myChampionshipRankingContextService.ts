import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];
const nullableString = (value: unknown) =>
  value === null || value === undefined || value === "" ? null : String(value);
const nullableNumber = (value: unknown) =>
  value === null || value === undefined || value === "" ? null : Number(value);

export type MyChampionshipRankingStanding = {
  teamId: string;
  teamLabel: string;
  clubName: string;
  teamNumber: string;
  officialRank: number | null;
  officialPoints: number | null;
  isMyTeam: boolean;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  scoreFor: number;
  scoreAgainst: number;
  scoreDifference: number;
  hasOfficialStanding: boolean;
};

export type MyChampionshipRankingPool = {
  poolId: string;
  poolCode: string;
  poolName: string | null;
  isMyPool: boolean;
  standings: MyChampionshipRankingStanding[];
};

export type MyChampionshipGeneralStanding = {
  teamId: string;
  teamLabel: string;
  clubName: string;
  teamNumber: string;
  poolId: string | null;
  poolCode: string | null;
  rank: number;
  poolRank: number | null;
  points: number | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  scoreFor: number;
  scoreAgainst: number;
  scoreDifference: number;
  isMyTeam: boolean;
};

export type MyChampionshipQualification = {
  directCutoff: number | null;
  barrageStart: number | null;
  barrageEnd: number | null;
  knockoutSize: number | null;
  source: "official_phases";
};

export type MyChampionshipRankingContext = {
  championshipId: string;
  divisionId: string;
  divisionName: string;
  myTeamId: string;
  myPoolId: string | null;
  qualification: MyChampionshipQualification;
  pools: MyChampionshipRankingPool[];
  generalStandings: MyChampionshipGeneralStanding[];
};

const mapStanding = (standing: Row): MyChampionshipRankingStanding => ({
  teamId: String(standing.team_id ?? ""),
  teamLabel: String(standing.team_label ?? ""),
  clubName: String(standing.club_name ?? ""),
  teamNumber: String(standing.team_number ?? ""),
  officialRank: nullableNumber(standing.official_rank),
  officialPoints: nullableNumber(standing.official_points),
  isMyTeam: Boolean(standing.is_my_team),
  played: Number(standing.played ?? 0),
  wins: Number(standing.wins ?? 0),
  draws: Number(standing.draws ?? 0),
  losses: Number(standing.losses ?? 0),
  scoreFor: Number(standing.score_for ?? 0),
  scoreAgainst: Number(standing.score_against ?? 0),
  scoreDifference: Number(standing.score_difference ?? 0),
  hasOfficialStanding: Boolean(standing.has_official_standing),
});

const mapContext = (row: Row): MyChampionshipRankingContext => {
  const qualification = (row.qualification ?? {}) as Row;
  return {
    championshipId: String(row.championship_id ?? ""),
    divisionId: String(row.division_id ?? ""),
    divisionName: String(row.division_name ?? ""),
    myTeamId: String(row.my_team_id ?? ""),
    myPoolId: nullableString(row.my_pool_id),
    qualification: {
      directCutoff: nullableNumber(qualification.direct_cutoff),
      barrageStart: nullableNumber(qualification.barrage_start),
      barrageEnd: nullableNumber(qualification.barrage_end),
      knockoutSize: nullableNumber(qualification.knockout_size),
      source: "official_phases",
    },
    pools: rows(row.pools).map((pool) => ({
      poolId: String(pool.pool_id ?? ""),
      poolCode: String(pool.pool_code ?? ""),
      poolName: nullableString(pool.pool_name),
      isMyPool: Boolean(pool.is_my_pool),
      standings: rows(pool.standings).map(mapStanding),
    })),
    generalStandings: rows(row.general_standings).map((standing) => ({
      teamId: String(standing.team_id ?? ""),
      teamLabel: String(standing.team_label ?? ""),
      clubName: String(standing.club_name ?? ""),
      teamNumber: String(standing.team_number ?? ""),
      poolId: nullableString(standing.pool_id),
      poolCode: nullableString(standing.pool_code),
      rank: Number(standing.rank ?? 0),
      poolRank: nullableNumber(standing.pool_rank),
      points: nullableNumber(standing.points),
      played: Number(standing.played ?? 0),
      wins: Number(standing.wins ?? 0),
      draws: Number(standing.draws ?? 0),
      losses: Number(standing.losses ?? 0),
      scoreFor: Number(standing.score_for ?? 0),
      scoreAgainst: Number(standing.score_against ?? 0),
      scoreDifference: Number(standing.score_difference ?? 0),
      isMyTeam: Boolean(standing.is_my_team),
    })),
  };
};

export const myChampionshipRankingContextService = {
  async list(): Promise<MyChampionshipRankingContext[]> {
    const { data, error } = await supabase.rpc(
      "get_my_championship_ranking_context",
    );
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de charger les classements du championnat.",
        ),
      );
    }
    return rows(data)
      .map(mapContext)
      .filter((item) => item.myTeamId);
  },
};
