import assert from "node:assert/strict";
import test from "node:test";
import { reconstructErrebotPdfRows } from "../.test-dist/src/features/admin/tournaments/domain/errebotPdfLayout.js";
import { parseErrebotTournament } from "../.test-dist/src/features/admin/tournaments/domain/errebotParser.js";

test("la reconstruction PDF conserve les lignes et les colonnes", () => {
  const text = reconstructErrebotPdfRows([
    { text: "100", x: 10, y: 700, width: 12 },
    { text: "1re", x: 40, y: 700, width: 12 },
    { text: "Série", x: 53, y: 700, width: 20 },
    { text: "Jean", x: 95, y: 700, width: 18 },
    { text: "Claude", x: 115, y: 700, width: 25 },
    { text: "Dupont", x: 165, y: 700, width: 25 },
    { text: "101", x: 10, y: 685, width: 12 },
    { text: "1re Série", x: 40, y: 685, width: 33 },
  ]);

  assert.equal(text, "100\t1re Série\tJean Claude\tDupont\n101\t1re Série");
});

const team = (id, series, first1, last1, first2, last2) =>
  [id, series, first1, last1, "0600000001", first2, last2, "0600000002"].join(
    "\t",
  );

const poolTeam = (id, label) => `${id} ${label}`;

test("le parseur reconstruit équipes, poules, matchs et créneaux libres", () => {
  const source = [
    team("100", "1re Série", "Alice", "Alpha", "Bob", "Bravo"),
    team("101", "1re Série", "Chloe", "Charlie", "Dan", "Delta"),
    team("102", "1re Série", "Emma", "Echo", "Fred", "Foxtrot"),
    team("200", "2me Série", "Gina", "Golf", "Hugo", "Hotel"),
    team("201", "2me Série", "Iris", "India", "Jules", "Juliett"),
    team("202", "2me Série", "Kara", "Kilo", "Leo", "Lima"),
    team("203", "2me Série", "Mona", "Mike", "Noe", "November"),
    [
      "1re Série",
      "A",
      poolTeam("100", "ALPHA - BRAVO"),
      poolTeam("101", "CHARLIE - DELTA"),
      poolTeam("102", "ECHO - FOXTROT"),
    ].join("\t"),
    [
      "2me Série",
      "A",
      poolTeam("200", "GOLF - HOTEL"),
      poolTeam("201", "INDIA - JULIETT"),
      poolTeam("202", "KILO - LIMA"),
      poolTeam("203", "MIKE - NOVEMBER"),
    ].join("\t"),
    "01/09/2026 18:30\t1re Série\tA\t100 ALPHA - BRAVO\t101 CHARLIE - DELTA",
    "02/09/2026 18:30\t1re Série\tA\t100 ALPHA - BRAVO\t102 ECHO - FOXTROT",
    "03/09/2026 18:30\t1re Série\tA\t101 CHARLIE - DELTA\t102 ECHO - FOXTROT",
    "04/09/2026 18:30\t2me Série\tA\t200 GOLF - HOTEL\t201 INDIA - JULIETT",
    "05/09/2026 18:30\t2me Série\tA\t200 GOLF - HOTEL\t202 KILO - LIMA",
    "06/09/2026 18:30\t2me Série\tA\t200 GOLF - HOTEL\t203 MIKE - NOVEMBER",
    "07/09/2026 18:30\t2me Série\tA\t201 INDIA - JULIETT\t202 KILO - LIMA",
    "08/09/2026 18:30\t2me Série\tA\t201 INDIA - JULIETT\t203 MIKE - NOVEMBER",
    "09/09/2026 18:30\t2me Série\tA\t202 KILO - LIMA\t203 MIKE - NOVEMBER",
    "10/09/2026 18:30",
  ].join("\n");

  const parsed = parseErrebotTournament(source);
  assert.equal(parsed.teams.length, 7);
  assert.equal(parsed.pools.length, 2);
  assert.equal(parsed.poolSize3Count, 1);
  assert.equal(parsed.fixtures.length, 9);
  assert.equal(parsed.emptySlotCount, 1);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.series, [
    { series: "1re Série", teamCount: 3, poolCount: 1, fixtureCount: 3 },
    { series: "2me Série", teamCount: 4, poolCount: 1, fixtureCount: 6 },
  ]);
});

test("le parseur détecte un calendrier incomplet", () => {
  const source = [
    team("100", "1re Série", "Alice", "Alpha", "Bob", "Bravo"),
    team("101", "1re Série", "Chloe", "Charlie", "Dan", "Delta"),
    team("102", "1re Série", "Emma", "Echo", "Fred", "Foxtrot"),
    "1re Série\tA\t100 ALPHA - BRAVO\t101 CHARLIE - DELTA\t102 ECHO - FOXTROT",
    "01/09/2026 18:30\t1re Série\tA\t100 ALPHA - BRAVO\t101 CHARLIE - DELTA",
  ].join("\n");
  const parsed = parseErrebotTournament(source);
  assert.ok(
    parsed.issues.some((issue) => issue.code === "fixture_set_mismatch"),
  );
});

test("le parseur récupère deux scores lorsqu'ils sont présents", () => {
  const source = [
    team("100", "1re Série", "Alice", "Alpha", "Bob", "Bravo"),
    team("101", "1re Série", "Chloe", "Charlie", "Dan", "Delta"),
    team("102", "1re Série", "Emma", "Echo", "Fred", "Foxtrot"),
    "1re Série\tA\t100 ALPHA - BRAVO\t101 CHARLIE - DELTA\t102 ECHO - FOXTROT",
    "01/09/2026 18:30\t1re Série\tA\t100 ALPHA - BRAVO\t15\t10\t101 CHARLIE - DELTA",
    "02/09/2026 18:30\t1re Série\tA\t100 ALPHA - BRAVO\t102 ECHO - FOXTROT",
    "03/09/2026 18:30\t1re Série\tA\t101 CHARLIE - DELTA\t102 ECHO - FOXTROT",
  ].join("\n");
  const parsed = parseErrebotTournament(source);
  assert.equal(parsed.fixtures[0].score1, 15);
  assert.equal(parsed.fixtures[0].score2, 10);
});
