import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migrationPath =
  "../supabase/migrations/20260811070000_tournament_admin_phases_and_live_configuration.sql";

test("le tournoi distingue les dates de poules et de phase finale", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /pool_starts_on/);
  assert.match(migration, /pool_ends_on/);
  assert.match(migration, /finals_starts_on/);
  assert.match(migration, /finals_ends_on/);
  assert.match(migration, /tournament_generated_slots/);
  assert.match(migration, /'pools'::text/);
  assert.match(migration, /'finals'::text/);
});

test("la configuration reste administrable pendant les inscriptions avec garde-fous", async () => {
  const migration = await read(migrationPath);

  assert.match(
    migration,
    /current_tournament\.status not in \([\s\S]*'registrations_open'[\s\S]*'registrations_closed'/,
  );
  assert.match(
    migration,
    /Tournament configuration would invalidate existing availability/,
  );
  assert.match(
    migration,
    /Tournament series capacity conflicts with existing teams/,
  );
  assert.match(migration, /Tournament series with teams cannot be removed/);
  assert.match(
    migration,
    /Tournament availability settings conflict with existing teams/,
  );
});

test("l'administration expose les paramètres de phase et les cartes naviguent vers le tableau", async () => {
  const [page, teamsPage] = await Promise.all([
    read("../src/features/admin/tournaments/pages/AdminTournamentsPage.tsx"),
    read(
      "../src/features/admin/tournaments/pages/AdminTournamentTeamsPage.tsx",
    ),
  ]);

  assert.match(page, /Début des poules/);
  assert.match(page, /Fin des poules/);
  assert.match(page, /Début de la phase finale/);
  assert.match(page, /Fin de la phase finale/);
  assert.match(page, /Durée d’un créneau/);
  assert.match(page, /Minimum de créneaux — poules/);
  assert.match(page, /registrations_open/);
  assert.match(teamsPage, /admin-tournament-series-card/);
  assert.match(teamsPage, /jumpToSeries/);
  assert.match(teamsPage, /admin-tournament-team-table/);
  assert.match(teamsPage, /Tableau des équipes/);
});

test("le formulaire joueur exige le minimum uniquement sur les créneaux de poules", async () => {
  const [form, grid] = await Promise.all([
    read(
      "../src/features/tournaments/components/TournamentRegistrationForm.tsx",
    ),
    read(
      "../src/features/tournaments/components/TournamentAvailabilityGrid.tsx",
    ),
  ]);

  assert.match(form, /poolAvailabilitySlots/);
  assert.match(form, /\(slot\.phase \?\? "pools"\) === "pools"/);
  assert.match(form, /phase de poules/);
  assert.match(grid, /Phase de poules/);
  assert.match(grid, /Phase finale/);
  assert.match(grid, /finalsSelected/);
  assert.match(grid, /poolSelected/);
});
