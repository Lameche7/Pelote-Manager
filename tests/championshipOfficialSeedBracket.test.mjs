import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  seedOrder,
  orderRoundOf32MatchesBySeed,
} from "../src/features/user-space/championships/domain/officialSeedBracket.mjs";

test("le tableau de 32 respecte les branches 1-32, 16-17, puis 8-25 et 9-24", () => {
  const seeds = seedOrder(32);
  assert.deepEqual(seeds.slice(0, 8), [1, 32, 16, 17, 8, 25, 9, 24]);
});

test("les seize 16es officiels de 4e série produisent les bons huitièmes", () => {
  const fixtures = Array.from({ length: 16 }, (_, index) => ({
    seed: index + 1,
    opponent: 33 - (index + 1),
    winner: "Équipe " + (index + 1),
  }));
  const ordered = orderRoundOf32MatchesBySeed(fixtures, (match) => match.seed);
  assert.deepEqual(
    ordered.map((match) => match.seed),
    [1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11],
  );
  const nextRound = [];
  for (let i = 0; i < ordered.length; i += 2) {
    nextRound.push([ordered[i].winner, ordered[i + 1].winner]);
  }
  assert.deepEqual(nextRound[0], ["Équipe 1", "Équipe 16"]);
  assert.deepEqual(nextRound[1], ["Équipe 8", "Équipe 9"]);
  assert.deepEqual(nextRound[2], ["Équipe 4", "Équipe 13"]);
  assert.deepEqual(nextRound[4], ["Équipe 2", "Équipe 15"]);
});

test("le composant utilise le tableau en branches au lieu d'un tri par classement", async () => {
  const source = await readFile(
    new URL(
      "../src/features/user-space/championships/components/ChampionshipFinalBracket.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /orderRoundOf32MatchesBySeed\(official16\.map/);
  assert.doesNotMatch(source, /return rank\(a\) - rank\(b\)/);
});
