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

test("le Mode TV conserve les séries publiques du tournoi", () => {
  assert.match(service, /tournamentService\.listPublic\(\)/);
  assert.match(service, /today <= endsOn/);
  assert.doesNotMatch(service, /startsOn <= today/);
  assert.match(service, /tournamentRankingService\.get\(tournament\.id\)/);
  assert.match(service, /tournamentResultsService\.get\(tournament\.id\)/);
});

test("chaque série génère deux écrans successifs classement puis matchs", () => {
  assert.match(
    page,
    /tournamentSeries\.flatMap\(\(series\) => \[/,
  );
  assert.match(page, /tournamentViewKey\(series, "ranking"\)/);
  assert.match(page, /tournamentViewKey\(series, "matches"\)/);
  assert.match(
    page,
    /activeView === tournamentViewKey\(series, "ranking"\)/,
  );
  assert.match(
    page,
    /activeView === tournamentViewKey\(series, "matches"\)/,
  );
  assert.match(page, /page=\{activeTournamentPage\}/);
});

test("la page classement affiche J V D points et goal-average", () => {
  assert.match(seriesView, /<th scope="col">J<\/th>/);
  assert.match(seriesView, /<th scope="col">V<\/th>/);
  assert.match(seriesView, /<th scope="col">D<\/th>/);
  assert.match(seriesView, /\? "P\/M" : "Pts"/);
  assert.match(seriesView, /\? "D\/M" : "Diff\."/);
  assert.match(seriesView, /\{team\.matchesPlayed\}/);
  assert.match(seriesView, /\{team\.wins\}/);
  assert.match(seriesView, /\{team\.losses\}/);
  assert.match(seriesView, /rankingValue\(team, series\)/);
  assert.match(seriesView, /goalAverageValue\(team, series\)/);
  assert.doesNotMatch(seriesView, /<h4>À suivre<\/h4>/);
});

test("la page résultats sépare résultats récents et prochains matchs", () => {
  assert.match(seriesView, /function MatchTeamLabel/);
  assert.match(seriesView, /label\.indexOf\(" \/ "\)/);
  assert.match(seriesView, /className="tv-tournament__match-team"/);
  assert.match(seriesView, /<MatchTeamLabel label=\{match\.teamALabel\} \/>/);
  assert.match(seriesView, /<MatchTeamLabel label=\{match\.teamBLabel\} \/>/);
  assert.match(seriesView, /<h3>Résultats<\/h3>/);
  assert.match(seriesView, /<h3>Prochains matchs<\/h3>/);
  assert.match(seriesView, /match\.resultStatus !== null/);
  assert.match(seriesView, /match\.resultStatus === null/);
  assert.match(seriesView, /scoreLabel\(match\)/);
  assert.match(seriesView, /Poule \{poolNumber\}/);
  assert.match(seriesView, /const MAX_MATCHES_PER_COLUMN = 6/);
});

test("les nombreuses poules restent paginées sur la seule page classement", () => {
  assert.match(seriesView, /const MAX_POOLS_PER_PAGE = 6/);
  assert.match(seriesView, /Math\.ceil\(poolCount \/ MAX_POOLS_PER_PAGE\)/);
  assert.match(seriesView, /series\.pools\.slice\(/);
  assert.match(seriesView, /const POOL_PAGE_DURATION_MS = 12_000/);
  assert.match(seriesView, /window\.setInterval/);
  assert.match(seriesView, /function RankingPage/);
  assert.match(seriesView, /function MatchesPage/);
});

test("la géométrie du classement reste limitée à trois colonnes et deux lignes", () => {
  assert.match(
    seriesView,
    /gridTemplateColumns: "repeat\(3, minmax\(0, 1fr\)\)"/,
  );
  assert.match(
    seriesView,
    /gridTemplateRows: "repeat\(2, minmax\(0, 1fr\)\)"/,
  );
  assert.match(seriesView, /style=\{poolGridStyle\(visiblePools\.length\)\}/);
});

test("les deux pages utilisent davantage d’espace pour la lecture TV", () => {
  assert.match(
    seriesStyles,
    /\.tv-tournament__ranking table\s*\{[^}]*font-size: clamp\(0\.8rem, 1\.7vmin, 1\.18rem\)/s,
  );
  assert.match(
    seriesStyles,
    /\.tv-tournament__match-board\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s,
  );
  assert.match(
    seriesStyles,
    /\.tv-tournament__match-team\s*\{[^}]*font-size: clamp\(0\.76rem, 1\.55vmin, 1\.08rem\)/s,
  );
  assert.match(
    seriesStyles,
    /\.tv-tournament__ranking th:nth-child\(2\)\s*\{[^}]*width: 52%/s,
  );
  assert.match(
    seriesStyles,
    /\.tv-tournament__ranking th:nth-child\(3\)[\s\S]*width: 6%/s,
  );
});
