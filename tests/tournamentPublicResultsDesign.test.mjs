import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migrationPath =
  "../supabase/migrations/20260817200000_add_public_tournament_results_and_calendar_colors.sql";

test("la vue publique regroupe matchs et résultats par série et poule", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /get_public_tournament_results/);
  assert.match(migration, /'color', series\.color/);
  assert.match(migration, /'pools'/);
  assert.match(migration, /'matches'/);
  assert.match(migration, /public\.tournament_team_public_label/);
  assert.match(migration, /result\.status = 'validated' then result\.score/);
  assert.match(migration, /'planning_published'/);
});

test("la page résultats devient sportive après publication", async () => {
  const [page, board] = await Promise.all([
    read("../src/features/tournaments/pages/TournamentDetailPage.tsx"),
    read("../src/features/tournaments/components/TournamentResultsBoard.tsx"),
  ]);

  assert.match(page, /tournamentResultsService\.get/);
  assert.match(page, /Résultats & classements/);
  assert.match(page, /<TournamentResultsBoard/);
  assert.match(board, /Séries du tournoi/);
  assert.match(board, /Poule \{pool\.number\}/);
  assert.match(board, />Matchs</);
  assert.match(board, />Classement</);
  assert.match(board, /Score attendu/);
  assert.match(board, /À valider/);
});

test("le classement public est volontairement compact", async () => {
  const board = await read(
    "../src/features/tournaments/components/TournamentResultsBoard.tsx",
  );

  assert.match(board, /<th>Cl\.<\/th>/);
  assert.match(board, /<th>Équipe<\/th>/);
  assert.match(board, /<th>MJ<\/th>/);
  assert.match(board, /rankingLabel/);
  assert.match(board, /goalAverageLabel/);
  assert.doesNotMatch(board, /Ranking Engine/);
});

test("le calendrier récupère et applique la couleur de série", async () => {
  const [migration, service, page, styles] = await Promise.all([
    read(migrationPath),
    read("../src/features/reservations/services/reservationCalendarService.ts"),
    read("../src/features/reservations/pages/ReservationsPage.tsx"),
    read("../src/features/reservations/pages/ReservationLockedSlots.css"),
  ]);

  assert.match(migration, /list_available_slots_v2/);
  assert.match(migration, /tournament_match_events/);
  assert.match(migration, /series\.color as display_color/);
  assert.match(service, /list_available_slots_v2/);
  assert.match(service, /displayColor: slot\.display_color/);
  assert.match(page, /reservation-slot--tournament/);
  assert.match(page, /--tournament-series-color/);
  assert.match(styles, /var\(--tournament-series-color\)/);
});
