export type FinalStageSeedSource =
  | { kind: "seed"; seed: number }
  | {
      kind: "preliminary_winner";
      preliminaryMatchIndex: number;
      seedA: number;
      seedB: number;
    };

export type FinalStageFirstRoundMatch = {
  matchIndex: number;
  sideA: FinalStageSeedSource;
  sideB: FinalStageSeedSource;
};

export type FinalStagePreliminaryMatch = {
  matchIndex: number;
  seedA: number;
  seedB: number;
};

export type FinalStagePlan = {
  qualifierCount: number;
  mainBracketSize: number;
  directEntryCount: number;
  preliminaryMatches: FinalStagePreliminaryMatch[];
  firstRoundMatches: FinalStageFirstRoundMatch[];
};

const isPowerOfTwo = (value: number) =>
  value >= 2 && (value & (value - 1)) === 0;

const largestPowerOfTwoAtMost = (value: number) => {
  let result = 1;
  while (result * 2 <= value) result *= 2;
  return result;
};

/**
 * Placement sportif des têtes de série dans le tableau principal.
 *
 * L'ordre 16 est celui retenu pour la pelote :
 * 1-16, 8-9, 4-13, 5-12, 3-14, 6-11, 7-10, 2-15.
 * Deux matchs consécutifs alimentent le même quart / tour suivant.
 */
export const finalStageSeedOrder = (bracketSize: number): number[] => {
  if (!isPowerOfTwo(bracketSize)) {
    throw new Error(
      "Le tableau principal doit contenir une puissance de deux.",
    );
  }

  if (bracketSize === 2) return [1, 2];
  if (bracketSize === 4) return [1, 4, 2, 3];
  if (bracketSize === 8) return [1, 8, 4, 5, 3, 6, 7, 2];
  if (bracketSize === 16) {
    return [1, 16, 8, 9, 4, 13, 5, 12, 3, 14, 6, 11, 7, 10, 2, 15];
  }

  const previous = finalStageSeedOrder(bracketSize / 2);
  const order: number[] = [];
  for (const seed of previous) {
    order.push(seed, bracketSize + 1 - seed);
  }
  return order;
};

export const buildFinalStagePlan = (qualifierCount: number): FinalStagePlan => {
  if (!Number.isInteger(qualifierCount) || qualifierCount < 2) {
    throw new Error("La phase finale doit qualifier au moins deux équipes.");
  }

  const mainBracketSize = largestPowerOfTwoAtMost(qualifierCount);
  const hasPreliminaryRound = qualifierCount !== mainBracketSize;
  const directEntryCount = hasPreliminaryRound
    ? 2 * mainBracketSize - qualifierCount
    : qualifierCount;

  const preliminaryMatches: FinalStagePreliminaryMatch[] = [];
  const preliminaryByMainSeed = new Map<number, FinalStagePreliminaryMatch>();

  if (hasPreliminaryRound) {
    for (let seed = directEntryCount + 1; seed <= mainBracketSize; seed += 1) {
      const preliminary = {
        matchIndex: preliminaryMatches.length + 1,
        seedA: seed,
        seedB: qualifierCount + 1 - seed,
      };
      preliminaryMatches.push(preliminary);
      preliminaryByMainSeed.set(seed, preliminary);
    }
  }

  const seedOrder = finalStageSeedOrder(mainBracketSize);
  const sourceForSeed = (seed: number): FinalStageSeedSource => {
    const preliminary = preliminaryByMainSeed.get(seed);
    if (!preliminary) return { kind: "seed", seed };
    return {
      kind: "preliminary_winner",
      preliminaryMatchIndex: preliminary.matchIndex,
      seedA: preliminary.seedA,
      seedB: preliminary.seedB,
    };
  };

  const firstRoundMatches: FinalStageFirstRoundMatch[] = [];
  for (let index = 0; index < seedOrder.length; index += 2) {
    firstRoundMatches.push({
      matchIndex: firstRoundMatches.length + 1,
      sideA: sourceForSeed(seedOrder[index]),
      sideB: sourceForSeed(seedOrder[index + 1]),
    });
  }

  return {
    qualifierCount,
    mainBracketSize,
    directEntryCount,
    preliminaryMatches,
    firstRoundMatches,
  };
};
