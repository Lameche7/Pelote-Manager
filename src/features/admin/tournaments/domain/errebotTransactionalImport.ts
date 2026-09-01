import type { ErrebotTournamentParseResult } from "./errebotParser.js";

export type ErrebotImportFileMetadata = {
  name: string;
  size: number;
  hash: string;
};

export type ErrebotTournamentImportSelection = {
  name: string;
  seasonId: string;
  resourceId: string;
  slotDurationMinutes: number;
};

export type ErrebotTournamentImportPayload = {
  file: {
    name: string;
    size: number;
    hash: string;
    parserVersion: string;
  };
  tournament: ErrebotTournamentImportSelection;
  series: Array<{ name: string }>;
  teams: ErrebotTournamentParseResult["teams"];
  pools: ErrebotTournamentParseResult["pools"];
  fixtures: ErrebotTournamentParseResult["fixtures"];
};

export type ErrebotTournamentImportResult = {
  importId: string;
  tournamentId: string;
  alreadyImported: boolean;
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
    resourceId: selection.resourceId,
    slotDurationMinutes: selection.slotDurationMinutes,
  },
  series: parsed.series.map((series) => ({ name: series.series })),
  teams: parsed.teams,
  pools: parsed.pools,
  fixtures: parsed.fixtures,
});
