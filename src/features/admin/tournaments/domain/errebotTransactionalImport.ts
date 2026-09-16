import type { ErrebotTournamentParseResult } from "./errebotParser.js";

export type ErrebotImportFileMetadata = {
  name: string;
  size: number;
  hash: string;
};

export type ErrebotTournamentMatchFormat = "single_game" | "best_of_three_sets";
export type ErrebotTournamentRankingMode = "total_points" | "points_per_match";
export type ErrebotTournamentGoalAverageMode =
  "point_difference" | "point_difference_per_match";

export const TOURNAMENT_SERIES_COLOR_PALETTE = [
  "#2563EB",
  "#DC2626",
  "#16A34A",
  "#9333EA",
  "#EA580C",
  "#0891B2",
  "#DB2777",
  "#4F46E5",
  "#65A30D",
  "#B45309",
] as const;

export const buildDefaultErrebotSeriesColors = (
  parsed: ErrebotTournamentParseResult,
): Record<string, string> =>
  Object.fromEntries(
    parsed.series.map((series, index) => [
      series.series,
      TOURNAMENT_SERIES_COLOR_PALETTE[
        index % TOURNAMENT_SERIES_COLOR_PALETTE.length
      ],
    ]),
  );

export type ErrebotTournamentSportingRulesSelection = {
  matchFormat: ErrebotTournamentMatchFormat;
  singleGamePoints: number;
  mainSetPoints: number;
  decidingSetPoints: number;
  baseWinPoints: number;
  baseLossPoints: number;
  offensiveBonusPoints: number;
  defensiveBonusPoints: number;
  offensiveBonusMargin: number;
  defensiveBonusMargin: number;
  rankingMode: ErrebotTournamentRankingMode;
  goalAverageMode: ErrebotTournamentGoalAverageMode;
};

export type ErrebotTournamentImportSelection = {
  name: string;
  seasonId: string;
  resourceIds: string[];
  primaryResourceId: string;
  slotDurationMinutes: number;
  seriesColors: Record<string, string>;
  sportingRules: ErrebotTournamentSportingRulesSelection;
};

export type ErrebotTournamentImportPayload = {
  file: {
    name: string;
    size: number;
    hash: string;
    parserVersion: string;
  };
  tournament: {
    name: string;
    seasonId: string;
    resourceIds: string[];
    primaryResourceId: string;
    slotDurationMinutes: number;
  };
  sportingRules: ErrebotTournamentSportingRulesSelection;
  series: Array<{ name: string; color: string }>;
  teams: ErrebotTournamentParseResult["teams"];
  pools: ErrebotTournamentParseResult["pools"];
  fixtures: ErrebotTournamentParseResult["fixtures"];
};

export type ErrebotTournamentImportResult = {
  importId: string;
  tournamentId: string;
  alreadyImported: boolean;
  optionsApplied?: boolean;
  primaryResourceId?: string;
  resourceCount?: number;
  matchFormat?: ErrebotTournamentMatchFormat;
  slotDurationMinutes?: number;
  summary: {
    teamCount: number;
    poolCount: number;
    matchCount: number;
    verifiedPlayerCount?: number;
    externalPlayerCount?: number;
    sourceScoreCount?: number;
  };
};

export const defaultErrebotTournamentName = (fileName: string) =>
  fileName
    .replace(/\.pdf$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const getErrebotTournamentDateRange = (
  parsed: ErrebotTournamentParseResult,
) => {
  const dates = parsed.fixtures.map((fixture) => fixture.date).sort();
  return {
    startsOn: dates[0] ?? "",
    endsOn: dates.at(-1) ?? "",
  };
};

export const buildErrebotTournamentImportPayload = (
  file: ErrebotImportFileMetadata,
  parsed: ErrebotTournamentParseResult,
  selection: ErrebotTournamentImportSelection,
): ErrebotTournamentImportPayload => ({
  file: {
    name: file.name,
    size: file.size,
    hash: file.hash,
    parserVersion: parsed.parserVersion,
  },
  tournament: {
    name: selection.name.trim(),
    seasonId: selection.seasonId,
    resourceIds: selection.resourceIds,
    primaryResourceId: selection.primaryResourceId,
    slotDurationMinutes: selection.slotDurationMinutes,
  },
  sportingRules: selection.sportingRules,
  series: parsed.series.map((series) => ({
    name: series.series,
    color: selection.seriesColors[series.series] ?? "#2563EB",
  })),
  teams: parsed.teams,
  pools: parsed.pools,
  fixtures: parsed.fixtures,
});
