import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [domain, page, routes, router, shell] = await Promise.all([
  read("src/features/user-space/statistics/domain/championshipStatistics.ts"),
  read("src/features/user-space/statistics/pages/MyStatisticsPage.tsx"),
  read("src/shared/config/routes.ts"),
  read("src/app/router.tsx"),
  read("src/features/user-space/components/UserSpaceShell.tsx"),
]);

test("ajoute Mes statistiques à l’espace joueur", () => {
  assert.match(routes, /myStatistics: "\/mon-espace\/statistiques"/);
  assert.match(router, /import \{ MyStatisticsPage \}/);
  assert.match(router, /path: ROUTES\.myStatistics/);
  assert.match(router, /<MyStatisticsPage \/>/);
  assert.match(shell, /to=\{ROUTES\.myStatistics\}/);
  assert.match(shell, /Mes statistiques/);
});

test("propose les filtres du tableau de bord sportif", () => {
  assert.match(domain, /season: string/);
  assert.match(domain, /specialty: string/);
  assert.match(domain, /championshipId: string/);
  assert.match(domain, /divisionId: string/);
  assert.match(domain, /phase: string/);
  assert.match(domain, /teamSide: StatisticsTeamSide/);
  assert.match(page, />Saison</);
  assert.match(page, />Discipline</);
  assert.match(page, />Championnat</);
  assert.match(page, />Série</);
  assert.match(page, />Phase</);
  assert.match(page, /Position sur la feuille/);
});

test("calcule les indicateurs victoire et protège les scores multi-disciplines", () => {
  assert.match(domain, /winRate: rows\.length \? \(wins \/ rows\.length\) \* 100 : 0/);
  assert.match(domain, /singleSpecialty: specialties\.size <= 1/);
  assert.match(domain, /currentStreak: currentStreak\(rows\)/);
  assert.match(page, /sélectionnez une seule discipline/);
  assert.match(page, /les barèmes diffèrent selon la discipline/);
});

test("ventile les résultats comme un tableau croisé", () => {
  assert.match(domain, /bySeason: breakdown/);
  assert.match(domain, /bySpecialty: breakdown/);
  assert.match(domain, /byPhase: breakdown/);
  assert.match(domain, /byChampionship: breakdown/);
  assert.match(page, /Par discipline/);
  assert.match(page, /Par saison/);
  assert.match(page, /Par phase/);
  assert.match(page, /Par championnat/);
});
