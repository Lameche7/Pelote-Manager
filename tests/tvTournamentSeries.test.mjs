import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [settings, page, service, seriesView] = await Promise.all([
  read("src/features/admin/settings/pages/AdminTvSettingsPage.tsx"),
  read("src/features/tv/pages/TvDisplayPage.tsx"),
  read("src/features/tv/services/tvTournamentService.ts"),
  read("src/features/tv/pages/TvTournamentSeriesView.tsx"),
]);

test("le lien Mode TV est toujours généré depuis le domaine application", () => {
  assert.match(settings, /currentApplicationOrigin\(\)/);
  assert.match(settings, /\$\{ROUTES\.tv\}\/\$\{settings\.publicToken\}/);
  assert.doesNotMatch(settings, /window\.location\.origin.*ROUTES\.tv/);
  assert.match(page, /const appUrl = currentApplicationOrigin\(\)/);
});

test("le Mode TV ajoute un écran par série seulement pendant la période du tournoi", () => {
  assert.match(service, /tournamentService\.listPublic\(\)/);
  assert.match(service, /startsOn <= today && today <= endsOn/);
  assert.match(service, /tournamentRankingService\.get\(tournament\.id\)/);
  assert.match(service, /tournamentResultsService\.get\(tournament\.id\)/);
  assert.match(service, /viewKey: `tournament:\$\{tournament\.id\}:\$\{resultSeries\.id\}`/);
  assert.match(page, /\.\.\.tournamentSeries\.map/);
  assert.match(page, /<TvTournamentSeriesView/);
});

test("chaque écran de série réunit classements de poules et résultats des parties", () => {
  assert.match(seriesView, /Poule \{pool\.number\}/);
  assert.match(seriesView, /pool\.teams\.map/);
  assert.match(seriesView, /pool\.matches\.map/);
  assert.match(seriesView, /<th scope="col">Cl\.<\/th>/);
  assert.match(seriesView, /<h4>Parties<\/h4>/);
  assert.match(seriesView, /En validation/);
  assert.match(seriesView, /À jouer/);
  assert.match(seriesView, /match\.score\.sets/);
});
