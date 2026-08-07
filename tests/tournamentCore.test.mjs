import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("le Tournament Core crée les agrégats et protège les données par RPC", async () => {
  const migration = await read(
    "../supabase/migrations/20260807160000_add_tournament_core.sql",
  );

  assert.match(migration, /create type public\.tournament_status as enum/);
  assert.match(migration, /create table public\.tournaments/);
  assert.match(migration, /create table public\.tournament_resources/);
  assert.match(migration, /create table public\.tournament_series/);
  assert.match(migration, /create table public\.tournament_play_windows/);
  assert.match(migration, /create table public\.tournament_audit_log/);
  assert.match(migration, /alter table public\.tournaments enable row level security/);
  assert.match(
    migration,
    /revoke all on table public\.tournaments from public, anon, authenticated/,
  );
  assert.match(migration, /has_club_permission\(target_club_id, 'tournaments\.manage'\)/);
  assert.match(migration, /admin_current_club_id\(\)/);
});

test("le cycle officiel existe et les transitions du noyau sont contrôlées", async () => {
  const migration = await read(
    "../supabase/migrations/20260807160000_add_tournament_core.sql",
  );

  for (const status of [
    "preparation",
    "configuration",
    "registrations_open",
    "registrations_closed",
    "pools_generated",
    "pools_validated",
    "planning_generated",
    "planning_published",
    "in_progress",
    "completed",
    "archived",
    "cancelled",
  ]) {
    assert.match(migration, new RegExp(`'${status}'`));
  }

  assert.match(
    migration,
    /create or replace function public\.admin_transition_tournament/,
  );
  assert.match(migration, /tournament_configuration_is_complete/);
  assert.match(migration, /status <> 'preparation'/);
  assert.match(migration, /status <> 'configuration'/);
  assert.match(migration, /status <> 'registrations_open'/);
  assert.match(migration, /Transition belongs to a future tournament engine/);
});

test("les inscriptions suivent automatiquement la fenêtre prévue", async () => {
  const migration = await read(
    "../supabase/migrations/20260807160000_add_tournament_core.sql",
  );

  assert.match(
    migration,
    /create or replace function public\.sync_tournament_registration_states/,
  );
  assert.match(migration, /registration_opens_at <= now\(\)/);
  assert.match(migration, /registration_closes_at > now\(\)/);
  assert.match(migration, /registration_closes_at <= now\(\)/);
  assert.match(migration, /registrations_opened_automatically/);
  assert.match(migration, /registrations_closed_automatically/);
});

test("la configuration prépare les futurs Pool et Planning Engines", async () => {
  const migration = await read(
    "../supabase/migrations/20260807160000_add_tournament_core.sql",
  );

  assert.match(migration, /resource_id uuid not null references public\.reservable_resources/);
  assert.match(migration, /capacity integer not null default 0/);
  assert.match(migration, /not enabled or capacity > 0/);
  assert.match(migration, /weekday smallint not null check \(weekday between 0 and 6\)/);
  assert.match(migration, /check \(closes_at > opens_at\)/);
  assert.match(migration, /admin_save_tournament_configuration/);
});

test("l'administration Tournois remplace l'écran provisoire", async () => {
  const [router, permissions, page, service] = await Promise.all([
    read("../src/app/router.tsx"),
    read("../src/features/admin/config/adminPermissions.ts"),
    read("../src/features/admin/tournaments/pages/AdminTournamentsPage.tsx"),
    read("../src/features/admin/tournaments/services/tournamentAdminService.ts"),
  ]);

  assert.match(router, /AdminTournamentsPage/);
  assert.doesNotMatch(router, /AdminComingSoonPage title="Tournois"/);
  assert.match(permissions, /label: "Tournois"/);
  assert.doesNotMatch(permissions, /label: "Tournois"[\s\S]{0,180}enabled: false/);
  assert.match(page, /Créer un tournoi/);
  assert.match(page, /Séries/);
  assert.match(page, /Horaires du tournoi/);
  assert.match(page, /Valider la configuration/);
  assert.match(service, /admin_create_tournament/);
  assert.match(service, /admin_save_tournament_configuration/);
  assert.match(service, /admin_transition_tournament/);
});
