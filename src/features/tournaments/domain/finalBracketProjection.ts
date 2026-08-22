import {
  buildFinalStagePlan,
  type FinalStageSeedSource,
} from "./finalStageEngine.js";

export type FinalBracketProjectionSeed = {
  seed: number;
  teamId: string;
  teamLabel: string;
};

export type FinalBracketProjectionActualMatch = {
  round: string;
  displayOrder: number;
  teamAId: string;
  teamALabel: string;
  teamBId: string;
  teamBLabel: string;
  winnerTeamId: string | null;
};

export type FinalBracketProjectionSide = {
  teamId: string;
  teamLabel: string;
};

export type FinalBracketProjectedMatch = {
  round: string;
  roundNumber: number;
  displayOrder: number;
  sideA: FinalBracketProjectionSide;
  sideB: FinalBracketProjectionSide;
};

const roundKeyForBracketSize = (bracketSize: number) => {
  if (bracketSize === 2) return "final";
  if (bracketSize === 4) return "semifinal";
  if (bracketSize === 8) return "quarterfinal";
  if (bracketSize === 16) return "round_of_16";
  if (bracketSize === 32) return "round_of_32";
  return `round_of_${bracketSize}`;
};

const winnerSourcePrefix = (round: string) => {
  if (round === "preliminary") return "Vainqueur du barrage";
  if (round === "semifinal") return "Vainqueur de la demi-finale";
  if (round === "quarterfinal") return "Vainqueur du quart de finale";
  if (round === "round_of_16") return "Vainqueur du 1/8 de finale";
  if (round === "round_of_32") return "Vainqueur du 1/16 de finale";
  return "Vainqueur du match";
};

const numberedWinnerSourceLabel = (round: string, displayOrder: number) => {
  const number = displayOrder + 1;
  if (round === "preliminary") return `Vainqueur barrage ${number}`;
  if (round === "semifinal") return `Vainqueur demi-finale ${number}`;
  if (round === "quarterfinal") return `Vainqueur quart de finale ${number}`;
  if (round === "round_of_16") return `Vainqueur 1/8 de finale ${number}`;
  if (round === "round_of_32") return `Vainqueur 1/16 de finale ${number}`;
  return `Vainqueur du match ${number}`;
};

const unresolvedSide = (teamLabel: string): FinalBracketProjectionSide => ({
  teamId: "",
  teamLabel,
});

export const buildFinalBracketProjectedMatches = ({
  qualifierCount,
  seeds,
  actualMatches,
}: {
  qualifierCount: number;
  seeds: FinalBracketProjectionSeed[];
  actualMatches: FinalBracketProjectionActualMatch[];
}): FinalBracketProjectedMatch[] => {
  if (
    !Number.isInteger(qualifierCount) ||
    qualifierCount < 2 ||
    seeds.length === 0
  ) {
    return [];
  }

  const plan = buildFinalStagePlan(qualifierCount);
  const seedByNumber = new Map(seeds.map((seed) => [seed.seed, seed]));
  const actualByRoundAndOrder = new Map(
    actualMatches.map((match) => [
      `${match.round}:${match.displayOrder}`,
      match,
    ]),
  );
  const projectedByRoundAndOrder = new Map<
    string,
    FinalBracketProjectedMatch
  >();

  const resolvedWinner = (
    round: string,
    displayOrder: number,
  ): FinalBracketProjectionSide | null => {
    const match = actualByRoundAndOrder.get(`${round}:${displayOrder}`);
    if (!match?.winnerTeamId) return null;
    if (match.winnerTeamId === match.teamAId) {
      return { teamId: match.teamAId, teamLabel: match.teamALabel };
    }
    if (match.winnerTeamId === match.teamBId) {
      return { teamId: match.teamBId, teamLabel: match.teamBLabel };
    }
    const seed = seeds.find((item) => item.teamId === match.winnerTeamId);
    return seed ? { teamId: seed.teamId, teamLabel: seed.teamLabel } : null;
  };

  const seedSide = (seedNumber: number): FinalBracketProjectionSide => {
    const seed = seedByNumber.get(seedNumber);
    return seed
      ? { teamId: seed.teamId, teamLabel: seed.teamLabel }
      : unresolvedSide("Équipe qualifiée");
  };

  const explicitWinnerSourceLabel = (
    round: string,
    displayOrder: number,
  ): string => {
    const key = `${round}:${displayOrder}`;
    const actualMatch = actualByRoundAndOrder.get(key);
    if (actualMatch) {
      return `${winnerSourcePrefix(round)} : ${actualMatch.teamALabel} – ${actualMatch.teamBLabel}`;
    }

    const projectedMatch = projectedByRoundAndOrder.get(key);
    if (projectedMatch) {
      return `${winnerSourcePrefix(round)} : ${projectedMatch.sideA.teamLabel} – ${projectedMatch.sideB.teamLabel}`;
    }

    return numberedWinnerSourceLabel(round, displayOrder);
  };

  const winnerSourceSide = (
    round: string,
    displayOrder: number,
  ): FinalBracketProjectionSide =>
    resolvedWinner(round, displayOrder) ??
    unresolvedSide(explicitWinnerSourceLabel(round, displayOrder));

  const firstRoundSide = (
    source: FinalStageSeedSource,
  ): FinalBracketProjectionSide => {
    if (source.kind === "seed") return seedSide(source.seed);
    return winnerSourceSide(
      "preliminary",
      source.preliminaryMatchIndex - 1,
    );
  };

  const mainRounds: string[] = [];
  let bracketSize = plan.mainBracketSize;
  while (bracketSize >= 2) {
    mainRounds.push(roundKeyForBracketSize(bracketSize));
    bracketSize /= 2;
  }

  const projected: FinalBracketProjectedMatch[] = [];
  const addProjectedMatch = (match: FinalBracketProjectedMatch) => {
    projected.push(match);
    projectedByRoundAndOrder.set(
      `${match.round}:${match.displayOrder}`,
      match,
    );
  };

  const firstRound = mainRounds[0];
  if (firstRound) {
    plan.firstRoundMatches.forEach((match, index) => {
      if (actualByRoundAndOrder.has(`${firstRound}:${index}`)) return;
      addProjectedMatch({
        round: firstRound,
        roundNumber: 1,
        displayOrder: index,
        sideA: firstRoundSide(match.sideA),
        sideB: firstRoundSide(match.sideB),
      });
    });
  }

  for (let roundIndex = 1; roundIndex < mainRounds.length; roundIndex += 1) {
    const round = mainRounds[roundIndex];
    const previousRound = mainRounds[roundIndex - 1];
    const matchCount = plan.mainBracketSize / 2 ** (roundIndex + 1);

    for (let displayOrder = 0; displayOrder < matchCount; displayOrder += 1) {
      if (actualByRoundAndOrder.has(`${round}:${displayOrder}`)) continue;
      const previousA = displayOrder * 2;
      const previousB = previousA + 1;
      addProjectedMatch({
        round,
        roundNumber: roundIndex + 1,
        displayOrder,
        sideA: winnerSourceSide(previousRound, previousA),
        sideB: winnerSourceSide(previousRound, previousB),
      });
    }
  }

  return projected;
};
