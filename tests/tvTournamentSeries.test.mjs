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

test("le lien Mode TV PCL reste l’adresse permanente officielle", () => {
  assert.match(
    settings,
    /const PUBLIC_TV_URL = "https:\/\/app\.pelotemanager\.fr\/tv\/pcl"/,
  );
  assert.match(settings, /const publicUrl = PUBLIC_TV_URL/);
  assert.match(page, /const appUrl = currentApplicationOrigin\(\)/);
});

test("le Mode TV peut afficher les poules avant le début du tournoi et les retire après sa fin", () => {
  assert.match(service, /tournamentService\.listPublic\(\)/);
  assert.match(service, /today <= endsOn/);
  assert.doesNotMatch(service, /startsOn <= today/);
  assert.match(service, /tournamentRankingService\.get\(tournament\.id\)/);
  assert.match(service, /tournamentResultsService\.get\(tournament\.id\)/);
  assert.match(
    service,
    /viewKey: `tournament:\$\{tournament\.id\}:\$\{resultSeries\.id\}`/,
  );
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
