export function seedOrder(size: number): number[];
export function orderRoundOf32MatchesBySeed<T>(
  matches: readonly T[],
  getSeed: (match: T) => number,
): T[];
