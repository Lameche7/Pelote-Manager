import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  importDomain,
  importFinalize,
  migration,
  publicationService,
  publicationPage,
  tvService,
  tvPage,
  tvTodayStyles,
  tvWeekStyles,
] = await Promise.all([
  read("../src/features/admin/tournaments/domain/errebotTransactionalImport.ts"),
  read(
    "../src/features/admin/tournaments/components/ErrebotTournamentImportFinalize.tsx",
  ),
  read(
    "../supabase/migrations/20260916114500_imported_tournament_series_colors_and_tv.sql",
  ),
  read(
    "../src/features/admin/tournaments/services/adminTournamentPublicationService.ts",
  ),
  read(
    "../src/features/admin/tournaments/pages/AdminTournamentPublicationPage.tsx",
  ),
  read("../src/features/tv/services/tvDisplayService.ts"),
  read("../src/features/tv/pages/TvDisplayPage.tsx"),
  read("../src/features/tv/pages/TvDisplayPage.css"),
  read("../src/features/tv/pages/TvWeeklyView.css"),
]);

test("l'import propose et transmet une couleur différente par série", () => {
  assert.match(importDomain, /TOURNAMENT_SERIES_COLOR_PALETTE/);
  assert.match(importDomain, /seriesColors: Record<string, string>/);
  assert.match(importDomain, /color: selection\.seriesColors\[series\.series\]/);
  assert.match(importFinalize, /4\. Couleurs des séries/);
  assert.match(importFinalize, /type="color"/);
  assert.match(importFinalize, /seriesColors/);
});

test("le serveur applique les couleurs dans la transaction d'import", () => {
  assert.match(
    migration,
    /create or replace function public\.admin_import_errebot_tournament_configured/,
  );
  assert.match(migration, /item_color := upper/);
  assert.match(migration, /set color = item_color/);
  assert.match(migration, /series\.tournament_id = target_tournament_id/);
});

test("les couleurs restent éditables sur un planning déjà publié", () => {
  assert.match(migration, /admin_get_tournament_series_colors/);
  assert.match(publicationService, /listSeriesColors/);
  assert.match(publicationService, /admin_update_tournament_series_colors/);
  assert.match(publicationPage, /Couleurs des séries/);
  assert.match(publicationPage, /Enregistrer les couleurs/);
});

test("le Mode TV reprend la couleur de série sur aujourd'hui et 7 jours", () => {
  assert.match(migration, /get_public_tv_tournament_slot_colors/);
  assert.match(migration, /series\.color as display_color/);
  assert.match(tvService, /get_public_tv_tournament_slot_colors/);
  assert.match(tvService, /displayColor/);
  assert.match(tvService, /seriesName/);
  assert.match(tvPage, /--tv-tournament-color/);
  assert.match(tvPage, /tv-display__slot--tournament/);
  assert.match(tvPage, /tv-display__week-item--tournament/);
  assert.match(tvTodayStyles, /var\(--tv-tournament-color\)/);
  assert.match(tvWeekStyles, /var\(--tv-tournament-color\)/);
});
