import { supabase } from "@/infrastructure/supabase/client";

type Row = Record<string, unknown>;

type RpcError = {
  message?: string;
};

type RpcResult = {
  data: unknown;
  error: RpcError | null;
};

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

const nullableNumber = (value: unknown): number | null =>
  value === null || value === undefined || value === "" ? null : Number(value);

export type ChampionshipStandingBrowserRow = {
  divisionId: string;
  divisionName: string;
  divisionDisplayOrder: number;
  poolId: string;
  poolCode: string;
  poolName: string | null;
  poolDisplayOrder: number;
  teamId: string;
  teamLabel: string;
  teamNumber: string;
  clubName: string;
  players: string[];
  standingRank: number | null;
  points: number | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  scoreFor: number;
  scoreAgainst: number;
  scoreDifference: number;
  hasOfficialStanding: boolean;
  isMyTeam: boolean;
  isMyDivision: boolean;
  isMyPool: boolean;
};

export type ChampionshipGeneralStandingBrowserRow = {
  divisionId: string;
  divisionName: string;
  divisionDisplayOrder: number;
  qualificationCutoff: number | null;
  qualificationSource: string | null;
  poolId: string;
  poolCode: string;
  teamId: string;
  teamLabel: string;
  teamNumber: string;
  clubName: string;
  players: string[];
  generalRank: number;
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
  isMyDivision: boolean;
};

const mapRow = (row: Row): ChampionshipStandingBrowserRow => ({
  divisionId: String(row.division_id ?? ""),
  divisionName: String(row.division_name ?? ""),
  divisionDisplayOrder: Number(row.division_display_order ?? 0),
  poolId: String(row.pool_id ?? ""),
  poolCode: String(row.pool_code ?? ""),
  poolName:
    row.pool_name === null || row.pool_name === undefined
      ? null
      : String(row.pool_name),
  poolDisplayOrder: Number(row.pool_display_order ?? 0),
  teamId: String(row.team_id ?? ""),
  teamLabel: String(row.team_label ?? ""),
  teamNumber: String(row.team_number ?? ""),
  clubName: String(row.club_name ?? ""),
  players: Array.isArray(row.players) ? row.players.map(String) : [],
  standingRank: nullableNumber(row.standing_rank),
  points: nullableNumber(row.points),
  played: Number(row.played ?? 0),
  wins: Number(row.wins ?? 0),
  draws: Number(row.draws ?? 0),
  losses: Number(row.losses ?? 0),
  scoreFor: Number(row.score_for ?? 0),
  scoreAgainst: Number(row.score_against ?? 0),
  scoreDifference: Number(row.score_difference ?? 0),
  hasOfficialStanding: Boolean(row.has_official_standing),
  isMyTeam: Boolean(row.is_my_team),
  isMyDivision: Boolean(row.is_my_division),
  isMyPool: Boolean(row.is_my_pool),
});

const mapGeneralRow = (row: Row): ChampionshipGeneralStandingBrowserRow => ({
  divisionId: String(row.division_id ?? ""),
  divisionName: String(row.division_name ?? ""),
  divisionDisplayOrder: Number(row.division_display_order ?? 0),
  qualificationCutoff: nullableNumber(row.qualification_cutoff),
  qualificationSource:
    row.qualification_source === null || row.qualification_source === undefined
      ? null
      : String(row.qualification_source),
  poolId: String(row.pool_id ?? ""),
  poolCode: String(row.pool_code ?? ""),
  teamId: String(row.team_id ?? ""),
  teamLabel: String(row.team_label ?? ""),
  teamNumber: String(row.team_number ?? ""),
  clubName: String(row.club_name ?? ""),
  players: Array.isArray(row.players) ? row.players.map(String) : [],
  generalRank: Number(row.general_rank ?? 0),
  poolRank: nullableNumber(row.pool_rank),
  points: nullableNumber(row.points),
  played: Number(row.played ?? 0),
  wins: Number(row.wins ?? 0),
  draws: Number(row.draws ?? 0),
  losses: Number(row.losses ?? 0),
  scoreFor: Number(row.score_for ?? 0),
  scoreAgainst: Number(row.score_against ?? 0),
  scoreDifference: Number(row.score_difference ?? 0),
  isMyTeam: Boolean(row.is_my_team),
  isMyDivision: Boolean(row.is_my_division),
});

const rpc = supabase.rpc.bind(supabase) as unknown as (
  functionName: string,
  args: Record<string, unknown>,
) => Promise<RpcResult>;

export const championshipStandingsService = {
  async list(
    championshipId: string,
  ): Promise<ChampionshipStandingBrowserRow[]> {
    const { data, error } = await rpc("list_championship_standings_browser", {
      target_championship_id: championshipId,
    });

    if (error) {
      throw new Error(
        error.message ||
          "Impossible de charger les classements du championnat.",
      );
    }

    return rows(data)
      .map(mapRow)
      .filter((row) => row.teamId && row.poolId);
  },

  async listGeneral(
    championshipId: string,
  ): Promise<ChampionshipGeneralStandingBrowserRow[]> {
    const { data, error } = await rpc(
      "list_championship_general_standings_browser",
      {
        target_championship_id: championshipId,
      },
    );

    if (error) {
      throw new Error(
        error.message || "Impossible de charger le classement général.",
      );
    }

    return rows(data)
      .map(mapGeneralRow)
      .filter((row) => row.teamId && row.divisionId && row.generalRank > 0);
  },
};
