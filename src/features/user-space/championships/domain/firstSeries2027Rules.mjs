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
