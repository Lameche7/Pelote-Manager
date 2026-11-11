import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { seedOrder } from "../src/features/user-space/championships/domain/officialSeedBracket.mjs";
import {
  firstSeries2027Weekends,
  firstSeriesEighthWinnerLabel,
  firstSeriesRankingIsComplete,
  isFirstSeries2027,
  openingRoundMatches,
} from "../src/features/user-space/championships/domain/firstSeries2027Rules.mjs";

test("seule la 1ère série masculine de l'hiver 2027 reçoit ce règlement", () => {
  assert.equal(isFirstSeries2027({ seasonLabel: "2027" }, "1ère série"), true);
  assert.equal(
    isFirstSeries2027({ seasonLabel: "2027" }, "Dames 1ère série"),
    false,
  );
  assert.equal(isFirstSeries2027({ seasonLabel: "2027" }, "2ème série"), false);
  assert.equal(isFirstSeries2027({ seasonLabel: "2026" }, "1ère série"), false);
});

test("12 qualifiés : les quatre têtes de série sont dispensées des 8èmes", () => {
  const order = seedOrder(16);
  const rounds = [];
  for (let index = 0; index < order.length; index += 2) {
    const label = (rank) => (rank <= 12 ? String(rank) : "Exempt");
    rounds.push({
      left: { label: label(order[index]), rank: order[index] },
      right: { label: label(order[index + 1]), rank: order[index + 1] },
    });
  }
  const played = openingRoundMatches(12, 16, rounds);
  assert.equal(played.length, 4);
  assert.deepEqual(
    played.map((match) => [match.left.rank, match.right.rank]),
    [
      [8, 9],
      [5, 12],
      [7, 10],
      [6, 11],
    ],
  );
  assert.deepEqual(
    rounds
      .filter((match) => match.right.label === "Exempt")
      .map((match) => match.left.rank),
    [1, 4, 2, 3],
  );
  assert.equal(openingRoundMatches(32, 32, rounds).length, 8);
});

test("calendrier prévisionnel et finale à Morlaàs, barrages B séparés", async () => {
  assert.equal(firstSeries2027Weekends["8es de finale"], "14–15 novembre 2026");
  assert.equal(
    firstSeries2027Weekends["Quarts de finale"],
    "21–22 novembre 2026",
  );
  assert.equal(firstSeries2027Weekends["Demi-finales"], "28–29 novembre 2026");
  assert.match(firstSeries2027Weekends.Finale, /5–6 décembre 2026 · Morlaàs/);

  const bracket = await readFile(
    new URL(
      "../src/features/user-space/championships/components/ChampionshipFinalBracket.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(bracket, /rank <= cutoff \? rankMap\.get\(rank\) : undefined/);
  assert.match(bracket, /openingRoundMatches\(cutoff, count, enriched\)/);
  assert.match(bracket, /B arrages Nationale B|Barrages Nationale B/);
  assert.match(bracket, /9e à 12e/);
  assert.match(bracket, /isFirstSeries &&/);
});

test("les 12 premiers rangs officiels suffisent malgré un forfait général", () => {
  const complete = Array.from({ length: 14 }, (_, index) => ({
    generalRank: index + 1,
    played: index % 3 === 0 ? 3 : 4,
    qualificationCutoff: 12,
  }));
  assert.equal(firstSeriesRankingIsComplete(complete), true);
  assert.equal(firstSeriesRankingIsComplete(complete.slice(0, 12)), true);
  assert.equal(firstSeriesRankingIsComplete(complete.slice(0, 11)), false);
  assert.equal(
    firstSeriesRankingIsComplete(
      complete.map((team) =>
        team.generalRank === 12 ? { ...team, generalRank: 11 } : team,
      ),
    ),
    false,
  );
  assert.equal(
    firstSeriesRankingIsComplete(
      complete.map((team) =>
        team.generalRank === 2
          ? { ...team, qualificationCutoff: 13 }
          : team,
      ),
    ),
    false,
  );
});

test("la projection ne doit pas faire monter en quarts une équipe à partir d'un classement incomplet", async () => {
  const source = await readFile(
    new URL(
      "../src/features/user-space/championships/components/ChampionshipFinalBracket.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /if \(incompleteFirstSeriesRanking\) return null/);
  assert.match(source, /Classement officiel insuffisant/);
  assert.match(source, /firstSeriesRankingIsComplete/);
});

test("les quatre quarts de 1re série annoncent le bon vainqueur des 8es", () => {
  const order = seedOrder(16);
  const firstRound = [];
  for (let i = 0; i < order.length; i += 2) {
    firstRound.push([order[i], order[i + 1]]);
  }
  const quarterFinals = [];
  for (let i = 0; i < firstRound.length; i += 2) {
    const seed = firstRound[i][0];
    const winner = firstSeriesEighthWinnerLabel(i * 2 + 2);
    quarterFinals.push([seed, winner]);
  }
  assert.deepEqual(quarterFinals, [
    [1, "Vainqueur 8e–9e"],
    [4, "Vainqueur 5e–12e"],
    [2, "Vainqueur 7e–10e"],
    [3, "Vainqueur 6e–11e"],
  ]);
  assert.equal(firstSeriesEighthWinnerLabel(4), null);
});

test("les mentions des quarts utilisent les rangs et non les numéros des cases masquées", async () => {
  const source = await readFile(
    new URL(
      "../src/features/user-space/championships/components/ChampionshipFinalBracket.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /firstSeriesEighthWinnerLabel\(index\)/);
});
