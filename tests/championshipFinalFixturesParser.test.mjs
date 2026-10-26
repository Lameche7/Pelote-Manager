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

test("les 32es de finale et barrages de quatrième série sont reconnus", () => {
  for (const label of ["1/32ème de finale", "32ème de finale", "1/32 de finale"]) {
    const parsed = parseDivisionResults(fixture(1, label), "3ème série");
    assert.equal(parsed.matches[0]?.phase, "1/32ème de finale", label);
  }
  const barrage = parseDivisionResults(fixture(2, "Barrages"), "4ème série");
  assert.equal(barrage.matches[0]?.phase, "Barrage");
});

test("une phase finale explicite prime sur un libellé Poules", () => {
  const html = fixture(1, "Poules") + field(1, "I222", "1/32ème de finale");
  const parsed = parseDivisionResults(html, "3ème série");
  assert.equal(parsed.matches[0]?.phase, "1/32ème de finale");
});
