import assert from "node:assert/strict";
import test from "node:test";
import { parseDivisionResults } from "../api/championship-results-source.mjs";

const field = (row, code, value) =>
  `<div id="zrl_${row}_ATT_${code}_1">${value}</div>`;
const fixture = (row, phase, score = "") =>
  `<div id="I158_${row}"></div>` +
  field(row, "I165", "<b>PELOTARI CLUB LOURDAIS 01</b>") +
  field(row, "I167", "<b>PELOTARI CLUB LOURDAIS 02</b>") +
  field(row, "I163", "23/10/2026") +
  field(row, "I220", phase) +
  field(row, "I168", score);

test("les rencontres finales sans score sont lues avec leur vraie phase", () => {
  const parsed = parseDivisionResults(
    fixture(1, "1/8ème de finale") + fixture(2, "Finale", "30-22"),
    "Dames 3ème série",
  );
  assert.equal(parsed.matches.length, 2);
  assert.equal(parsed.results.length, 1);
  assert.equal(parsed.matches[0].phase, "1/8ème de finale");
  assert.equal(parsed.matches[1].phase, "Finale");
  assert.equal(parsed.matches[0].sourceDate, "2026-10-23");
});

test("une phase non identifiable n'est jamais proposée à l'import automatique", () => {
  const parsed = parseDivisionResults(
    fixture(1, "Terrain principal"),
    "Dames 3ème série",
  );
  assert.equal(parsed.matches.length, 0);
});
