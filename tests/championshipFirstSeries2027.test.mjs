import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { seedOrder } from "../src/features/user-space/championships/domain/officialSeedBracket.mjs";
import {
  firstSeries2027Weekends,
  isFirstSeries2027,
  openingRoundMatches,
} from "../src/features/user-space/championships/domain/firstSeries2027Rules.mjs";

test("seule la 1ère série masculine de l'hiver 2027 reçoit ce règlement", () => {
  assert.equal(isFirstSeries2027({ seasonLabel: "2027" }, "1ère série"), true);
  assert.equal(isFirstSeries2027({ seasonLabel: "2027" }, "Dames 1ère série"), false);
  assert.equal(isFirstSeries2027({ seasonLabel: "2027" }, "2ème série"), false);
  assert.equal(isFirstSeries2027({ seasonLabel: "2026" }, "1ère série"), false);
});

test("12 qualifiés : les quatre têtes de série sont dispensées des 8èmes", () => {
  const order = seedOrder(16);
  const rounds = [];
  for (let index = 0; index < order.length; index += 2) {
    const label = (rank) => rank <= 12 ? String(rank) : "Exempt";
    rounds.push({
      left: { label: label(order[index]), rank: order[index] },
      right: { label: label(order[index + 1]), rank: order[index + 1] },
    });
  }
  const played = openingRoundMatches(12, 16, rounds);
  assert.equal(played.length, 4);
  assert.deepEqual(
    played.map((match) => [match.left.rank, match.right.rank]),
    [[8, 9], [5, 12], [7, 10], [6, 11]],
  );
  assert.deepEqual(
    rounds.filter((match) => match.right.label === "Exempt")
      .map((match) => match.left.rank),
    [1, 4, 2, 3],
  );
  assert.equal(openingRoundMatches(32, 32, rounds).length, 8);
});

test("calendrier prévisionnel et finale à Morlaàs, barrages B séparés", async () => {
  assert.equal(firstSeries2027Weekends["8es de finale"], "14–15 novembre 2026");
  assert.equal(firstSeries2027Weekends["Quarts de finale"], "21–22 novembre 2026");
  assert.equal(firstSeries2027Weekends["Demi-finales"], "28–29 novembre 2026");
  assert.match(firstSeries2027Weekends.Finale, /5–6 décembre 2026 · Morlaàs/);

  const bracket = await readFile(
    new URL("../src/features/user-space/championships/components/ChampionshipFinalBracket.tsx", import.meta.url),
    "utf8",
  );
  assert.match(bracket, /rank <= cutoff \? rankMap\.get\(rank\) : undefined/);
  assert.match(bracket, /openingRoundMatches\(cutoff, count, enriched\)/);
  assert.match(bracket, /B arrages Nationale B|Barrages Nationale B/);
  assert.match(bracket, /9e à 12e/);
  assert.match(bracket, /isFirstSeries &&/);
});
