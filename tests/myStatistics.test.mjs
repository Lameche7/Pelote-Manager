import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [
  domain,
  page,
  routes,
  router,
  shell,
  dashboard,
  tournamentService,
  sportingRulesSection,
  migration,
] = await Promise.all([
  read("src/features/user-space/statistics/domain/championshipStatistics.ts"),
  read("src/features/user-space/statistics/pages/MyStatisticsPage.tsx"),
  read("src/shared/config/routes.ts"),
  read("src/app/router.tsx"),
  read("src/features/user-space/components/UserSpaceShell.tsx"),
  read("src/features/user-space/dashboard/pages/UserSpaceDashboardPage.tsx"),
  read(
    "src/features/user-space/statistics/services/myTournamentStatisticsService.ts",
  ),
  read(
    "src/features/admin/tournaments/components/TournamentSportingRulesSection.tsx",
  ),
  read(
    "supabase/migrations/20260914092333_add_tournament_statistics_and_specialty.sql",
  ),
]);

test("ajoute Mes statistiques à l’espace joueur", () => {
  assert.match(routes, /myStatistics: "\/mon-espace\/statistiques"/);
  assert.match(router, /import \{ MyStatisticsPage \}/);
  assert.match(router, /path: ROUTES\.myStatistics/);
  assert.match(router, /<MyStatisticsPage \/>/);
  assert.match(shell, /to=\{ROUTES\.myStatistics\}/);
  assert.match(shell, /Mes statistiques/);
  assert.match(dashboard, /title: "Mes statistiques"/);
  assert.match(dashboard, /to: ROUTES\.myStatistics/);
});

test("propose les filtres du tableau de bord sportif unifié", () => {
  assert.match(domain, /source: StatisticsSource/);
  assert.match(domain, /season: string/);
  assert.match(domain, /specialty: string/);
  assert.match(domain, /competitionId: string/);
  assert.match(domain, /divisionId: string/);
  assert.match(domain, /phase: string/);
  assert.match(domain, /teamSide: StatisticsTeamSide/);
  assert.match(page, /Type de compétition/);
  assert.match(page, />Championnats</);
  assert.match(page, />Tournois</);
  assert.match(page, />Saison</);
  assert.match(page, />Discipline</);
  assert.match(page, />Compétition</);
  assert.match(page, />Série</);
  assert.match(page, />Phase</);
});

test("la pelote ne produit jamais de statistique de match nul", () => {
  assert.doesNotMatch(domain, /"draw"/);
  assert.doesNotMatch(page, /Nul/);
  assert.doesNotMatch(page, /nul\(s\)/);
  assert.match(domain, /if \(match\.scoreMine === match\.scoreOpponent\) return/);
  assert.match(domain, /losses = rows\.length - wins/);
});

test("agrège les résultats validés de tournois", () => {
  assert.match(tournamentService, /get_my_tournament_statistics/);
  assert.match(domain, /buildTournamentStatisticsRows/);
  assert.match(domain, /match\.won \? "win" : "loss"/);
  assert.match(page, /myTournamentStatisticsService\.list\(\)/);
  assert.match(migration, /match_result\.status = 'validated'/);
  assert.match(migration, /match_result\.winner_team_id is not null/);
});

test("permet de renseigner la discipline d’un tournoi", () => {
  assert.match(migration, /add column if not exists specialty text/);
  assert.match(migration, /admin_get_tournament_specialty/);
  assert.match(migration, /admin_set_tournament_specialty/);
  assert.match(sportingRulesSection, /Discipline du tournoi/);
  assert.match(sportingRulesSection, /admin_get_tournament_specialty/);
  assert.match(sportingRulesSection, /admin_set_tournament_specialty/);
  assert.match(sportingRulesSection, /Enregistrer la discipline/);
});

test("protège les indicateurs de score quand les barèmes diffèrent", () => {
  assert.match(domain, /scoreMetricKey/);
  assert.match(domain, /scoreMetricsComparable: metricKeys\.size <= 1/);
  assert.match(page, /barèmes différents dans la sélection/);
  assert.match(page, /filtrez un barème comparable/);
});

test("ventile les résultats comme un tableau croisé", () => {
  assert.match(domain, /bySource: breakdown/);
  assert.match(domain, /bySeason: breakdown/);
  assert.match(domain, /bySpecialty: breakdown/);
  assert.match(domain, /byPhase: breakdown/);
  assert.match(domain, /byCompetition: breakdown/);
  assert.match(page, /Par type/);
  assert.match(page, /Par discipline/);
  assert.match(page, /Par saison/);
  assert.match(page, /Par phase/);
  assert.match(page, /Par compétition/);
});
