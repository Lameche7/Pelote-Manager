import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [settings, page, service, seriesView, seriesStyles] = await Promise.all([
  read("src/features/admin/settings/pages/AdminTvSettingsPage.tsx"),
  read("src/features/tv/pages/TvDisplayPage.tsx"),
  read("src/features/tv/services/tvTournamentService.ts"),
  read("src/features/tv/pages/TvTournamentSeriesView.tsx"),
  read("src/features/tv/pages/TvTournamentSeriesView.css"),
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

test("chaque poule affiche son classement et seulement les deux prochaines parties", () => {
  assert.match(seriesView, /Poule \{pool\.number\}/);
  assert.match(seriesView, /pool\.teams\.map/);
  assert.match(seriesView, /match\.resultStatus === null/);
  assert.match(seriesView, /scheduledStartAt/);
  assert.match(seriesView, /\.slice\(0, 2\)/);
  assert.match(seriesView, /const upcoming = nextMatches\(pool\.matches\)/);
  assert.doesNotMatch(seriesView, /pool\.matches\.map/);
  assert.match(seriesView, /<th scope="col">Cl\.<\/th>/);
  assert.match(seriesView, /<h4>À suivre<\/h4>/);
  assert.match(seriesView, /<strong>vs<\/strong>/);
});

test("six poules sont équilibrées en trois colonnes sur deux lignes", () => {
  assert.match(seriesView, /series\.pools\.length === 6/);
  assert.match(seriesView, /tv-tournament__pools--six/);
  assert.match(
    seriesStyles,
    /\.tv-tournament__pools--six\s*\{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/s,
  );
  assert.match(
    seriesStyles,
    /\.tv-tournament__pools--six\s*\{[^}]*grid-template-rows: repeat\(2, minmax\(0, 1fr\)\)/s,
  );
});
