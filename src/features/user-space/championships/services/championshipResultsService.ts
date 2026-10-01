import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];
const nullableString = (value: unknown) =>
  value === null || value === undefined || value === "" ? null : String(value);
const nullableNumber = (value: unknown) =>
  value === null || value === undefined || value === "" ? null : Number(value);

export type ChampionshipResultsDivision = {
  id: string;
  name: string;
  displayOrder: number;
};

export type ChampionshipResultsCatalogItem = {
  championshipId: string;
  championshipName: string;
  specialty: string;
  seasonLabel: string;
  championshipStatus: string;
  sourceUrl: string | null;
  hasMyTeam: boolean;
  hasMyClubTeam: boolean;
  myDivisionIds: string[];
  divisions: ChampionshipResultsDivision[];
  resultCount: number;
};

export type ChampionshipOfficialResult = {
  matchId: string;
  divisionId: string;
  divisionName: string;
  divisionDisplayOrder: number;
  poolId: string | null;
  poolCode: string | null;
  poolName: string | null;
  phase: string;
  playedOn: string | null;
  playedTime: string | null;
  venue: string | null;
  team1Id: string;
  team1Label: string;
  team1ClubName: string;
  team1Players: string[];
  team1IsMyTeam: boolean;
  team1IsMyClub: boolean;
  team2Id: string;
  team2Label: string;
  team2ClubName: string;
  team2Players: string[];
  team2IsMyTeam: boolean;
  team2IsMyClub: boolean;
  scoreTeam1: number | null;
  scoreTeam2: number | null;
  scoreRaw: string | null;
};

const mapCatalog = (row: Row): ChampionshipResultsCatalogItem => ({
  championshipId: String(row.championship_id ?? ""),
  championshipName: String(row.championship_name ?? ""),
  specialty: String(row.specialty ?? ""),
  seasonLabel: String(row.season_label ?? ""),
  championshipStatus: String(row.championship_status ?? ""),
  sourceUrl: nullableString(row.source_url),
  hasMyTeam: Boolean(row.has_my_team),
  hasMyClubTeam: Boolean(row.has_my_club_team),
  myDivisionIds: Array.isArray(row.my_division_ids)
    ? row.my_division_ids.map(String)
    : [],
  divisions: rows(row.divisions).map((division) => ({
    id: String(division.id ?? ""),
    name: String(division.name ?? ""),
    displayOrder: Number(division.display_order ?? 0),
  })),
  resultCount: Number(row.result_count ?? 0),
});

const mapResult = (row: Row): ChampionshipOfficialResult => ({
  matchId: String(row.match_id ?? ""),
  divisionId: String(row.division_id ?? ""),
  divisionName: String(row.division_name ?? ""),
  divisionDisplayOrder: Number(row.division_display_order ?? 0),
  poolId: nullableString(row.pool_id),
  poolCode: nullableString(row.pool_code),
  poolName: nullableString(row.pool_name),
  phase: String(row.phase ?? ""),
  playedOn: nullableString(row.played_on),
  playedTime: nullableString(row.played_time),
  venue: nullableString(row.venue),
  team1Id: String(row.team1_id ?? ""),
  team1Label: String(row.team1_label ?? ""),
  team1ClubName: String(row.team1_club_name ?? ""),
  team1Players: Array.isArray(row.team1_players)
    ? row.team1_players.map(String)
    : [],
  team1IsMyTeam: Boolean(row.team1_is_my_team),
  team1IsMyClub: Boolean(row.team1_is_my_club),
  team2Id: String(row.team2_id ?? ""),
  team2Label: String(row.team2_label ?? ""),
  team2ClubName: String(row.team2_club_name ?? ""),
  team2Players: Array.isArray(row.team2_players)
    ? row.team2_players.map(String)
    : [],
  team2IsMyTeam: Boolean(row.team2_is_my_team),
  team2IsMyClub: Boolean(row.team2_is_my_club),
  scoreTeam1: nullableNumber(row.score_team1),
  scoreTeam2: nullableNumber(row.score_team2),
  scoreRaw: nullableString(row.score_raw),
});

export const championshipResultsService = {
  async listCatalog(): Promise<ChampionshipResultsCatalogItem[]> {
    const { data, error } = await supabase.rpc(
      "list_championship_results_catalog",
    );
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de charger les championnats disponibles.",
        ),
      );
    }
    return rows(data).map(mapCatalog);
  },

  async listResults(
    championshipId: string,
  ): Promise<ChampionshipOfficialResult[]> {
    const { data, error } = await supabase.rpc("list_championship_results", {
      target_championship_id: championshipId,
    });
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de charger les résultats du championnat.",
        ),
      );
    }
    return rows(data).map(mapResult);
  },
};
