// Règlement transmis pour la 1ère série du championnat d'hiver du Béarn 2026-27.
// These dates are scheduled weekends, not confirmed individual fixture dates.
export const firstSeries2027Weekends = Object.freeze({
  "8es de finale": "14–15 novembre 2026",
  "Quarts de finale": "21–22 novembre 2026",
  "Demi-finales": "28–29 novembre 2026",
  Finale: "5–6 décembre 2026 · Morlaàs",
});

export function isFirstSeries2027(championship, divisionName) {
  return (
    championship?.seasonLabel === "2027" &&
    /1(?:ère|ere|re|e)?\s*série/i.test(divisionName ?? "") &&
    !/dames|féminin|feminin/i.test(divisionName ?? "")
  );
}

export function openingRoundMatches(cutoff, size, matches) {
  if (cutoff === 12 && size === 16) {
    // Ranks 1–4 advance automatically: four actual matches, ranks 5–12.
    return matches.filter(
      (pair) => pair.left.label !== "Exempt" && pair.right.label !== "Exempt",
    );
  }
  return matches;
}

export function firstSeriesRankingIsComplete(ranking, qualificationCutoff = 12) {
  // Forfeits can remove teams from the official ranking. Only the qualifying
  // ranks are required to project the final bracket; played counts may differ.
  if (!Number.isInteger(qualificationCutoff) || qualificationCutoff < 2) return false;
  const ranks = new Set(
    ranking
      .map((team) => team.generalRank)
      .filter((rank) => Number.isInteger(rank) && rank >= 1 && rank <= qualificationCutoff),
  );
  return ranks.size === qualificationCutoff;
}

/**
 * The first round internally has eight slots (four byes + four matches).
 * Its internal slot numbering MUST NOT be presented as the visible
 * eighth-final match numbering. State the seeded pairing explicitly.
 */
export function firstSeriesEighthWinnerLabel(firstRoundPairIndex) {
  const pairings = {
    2: "Vainqueur 8e–9e",
    6: "Vainqueur 5e–12e",
    10: "Vainqueur 7e–10e",
    14: "Vainqueur 6e–11e",
  };
  return pairings[firstRoundPairIndex] ?? null;
}
