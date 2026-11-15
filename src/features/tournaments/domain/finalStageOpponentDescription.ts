import {
  buildFinalStagePlan,
  type FinalStageSeedSource,
} from "./finalStageEngine.js";
import type {
  FinalStagePlanningNode,
  FinalStagePlanningSeed,
} from "./finalStagePlanningEngine.js";

const roundNames: Record<string, string> = {
  preliminary: "du barrage",
  round_of_32: "du 1/16",
  round_of_16: "du 1/8",
  quarterfinal: "du quart",
  semifinal: "de la demi-finale",
  final: "de la finale",
};

const qualifiedLabel = (source: FinalStagePlanningNode) =>
  `Vainqueur ${roundNames[source.round] ?? "du tour"} n°${source.displayOrder + 1}`;

const preliminarySource = (
  source: Extract<FinalStageSeedSource, { kind: "preliminary_winner" }>,
  seeds: Map<number, string>,
) => {
  const one = seeds.get(source.seedA);
  const two = seeds.get(source.seedB);
  const candidates = one && two ? ` (${one} ou ${two})` : "";
  return `Vainqueur du barrage n°${source.preliminaryMatchIndex}${candidates}`;
};

/**
 * Explains the two bracket entry paths without guessing future winners.
 * Used by the detailed admin screen, weekly overview and its PDF export.
 */
export const describeFinalStageOpponents = ({
  node,
  nodes,
  seeds,
}: {
  node: FinalStagePlanningNode;
  nodes: FinalStagePlanningNode[];
  seeds: FinalStagePlanningSeed[];
}): string => {
  if (node.teamALabel && node.teamBLabel) {
    return `${node.teamALabel} — ${node.teamBLabel}`;
  }

  if (node.round === "preliminary" && node.possibleTeamLabels.length === 2) {
    return node.possibleTeamLabels.join(" — ");
  }

  const seedsByRank = new Map(seeds.map((seed) => [seed.seed, seed.teamLabel]));

  if (node.roundNumber === 1) {
    const source = buildFinalStagePlan(seeds.length).firstRoundMatches.find(
      (match) => match.matchIndex === node.displayOrder + 1,
    );
    if (source) {
      const label = (side: FinalStageSeedSource): string =>
        side.kind === "seed"
          ? (seedsByRank.get(side.seed) ?? `Qualifié n°${side.seed}`)
          : preliminarySource(side, seedsByRank);
      return `${label(source.sideA)} — ${label(source.sideB)}`;
    }
  }

  const sourceNodes = node.dependencyNodeIds
    .map((id) => nodes.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is FinalStagePlanningNode =>
      Boolean(candidate),
    );
  if (sourceNodes.length === 2) {
    return sourceNodes.map(qualifiedLabel).join(" — ");
  }

  return "Participants en attente des tours précédents";
};
