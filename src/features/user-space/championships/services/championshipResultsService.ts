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

export type ChampionshipBrowserMatch = {
  matchId: string;
  divisionId: string;
  divisionName: string;
  divisionDisplayOrder: number;
  poolId: string | null;
  poolCode: string | null;
  poolName: string | null;
  phase: string;
  matchStatus: string;
  theoreticalOn: string | null;
  effectiveOn: string | null;
  effectiveTime: string | null;
  scheduleSource: string;
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
  officialScoreTeam1: number | null;
  officialScoreTeam2: number | null;
  proposedScoreTeam1: number | null;
  proposedScoreTeam2: number | null;
  proposedByTeamLabel: string | null;
  displayedScoreTeam1: number | null;
  displayedScoreTeam2: number | null;
  resultSource: "official" | "proposed" | "none";
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

const mapMatch = (row: Row): ChampionshipBrowserMatch => ({
  matchId: String(row.match_id ?? ""),
  divisionId: String(row.division_id ?? ""),
  divisionName: String(row.division_name ?? ""),
  divisionDisplayOrder: Number(row.division_display_order ?? 0),
  poolId: nullableString(row.pool_id),
  poolCode: nullableString(row.pool_code),
  poolName: nullableString(row.pool_name),
  phase: String(row.phase ?? ""),
  matchStatus: String(row.match_status ?? ""),
  theoreticalOn: nullableString(row.theoretical_on),
  effectiveOn: nullableString(row.effective_on),
  effectiveTime: nullableString(row.effective_time),
  scheduleSource: String(row.schedule_source ?? "unknown"),
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
  officialScoreTeam1: nullableNumber(row.official_score_team1),
  officialScoreTeam2: nullableNumber(row.official_score_team2),
  proposedScoreTeam1: nullableNumber(row.proposed_score_team1),
  proposedScoreTeam2: nullableNumber(row.proposed_score_team2),
  proposedByTeamLabel: nullableString(row.proposed_by_team_label),
  displayedScoreTeam1: nullableNumber(row.displayed_score_team1),
  displayedScoreTeam2: nullableNumber(row.displayed_score_team2),
  resultSource: String(
    row.result_source ?? "none",
  ) as ChampionshipBrowserMatch["resultSource"],
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
          "Impossible de charger les championnats.",
        ),
      );
    }
    return rows(data).map(mapCatalog);
  },

  async listMatches(
    championshipId: string,
  ): Promise<ChampionshipBrowserMatch[]> {
    const { data, error } = await supabase.rpc(
      "list_championship_match_browser",
      {
        target_championship_id: championshipId,
      },
    );
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(error, "Impossible de charger les rencontres."),
      );
    }
    return rows(data).map(mapMatch);
  },
};
