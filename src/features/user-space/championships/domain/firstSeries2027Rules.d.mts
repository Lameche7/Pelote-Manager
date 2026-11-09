export const firstSeries2027Weekends: Readonly<Record<string, string>>;
export function isFirstSeries2027(
  championship: { seasonLabel: string } | undefined,
  divisionName: string,
): boolean;
export function openingRoundMatches<
  T extends {
    left: { label: string };
    right: { label: string };
  },
>(cutoff: number, size: number, matches: T[]): T[];
export function firstSeriesRankingIsComplete(
  ranking: readonly { generalRank: number; played: number }[],
): boolean;
