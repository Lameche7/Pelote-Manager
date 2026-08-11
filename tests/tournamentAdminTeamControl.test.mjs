import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migrationPath =
  "../supabase/migrations/20260811133500_restore_admin_tournament_team_control.sql";

test("l'administrateur garde la main jusqu'aux poules validées", async () => {
  const [migration, page] = await Promise.all([
    read(migrationPath),
    read(
      "../src/features/admin/tournaments/pages/AdminTournamentTeamsPage.tsx",
    ),
  ]);

  assert.match(migration, /'pools_generated'/);
  assert.match(migration, /'pools_validated'/);
  assert.match(
    migration,
    /Tournament teams cannot be changed after planning generation/,
  );
  assert.match(page, /"pools_generated"/);
  assert.match(page, /"pools_validated"/);
  assert.match(page, />\s*Modifier\s*</);
});

test("une correction non structurelle conserve les poules", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /preserve_pool_status boolean := false/);
  assert.match(migration, /team_updated_with_pools_preserved/);
  assert.match(
    migration,
    /set[\s\S]*status = previous_status[\s\S]*where id = target_tournament\.id/,
  );
});

test("une modification structurelle invalide proprement les poules", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /structural_change boolean := false/);
  assert.match(
    migration,
    /delete from public\.tournament_pools[\s\S]*where tournament_id = target_tournament\.id/,
  );
  assert.match(migration, /status = 'registrations_closed'/);
  assert.match(migration, /pools_invalidated_by_team_change/);
});

test("la suppression admin est réelle, confirmée et auditée", async () => {
  const [migration, service, page] = await Promise.all([
    read(migrationPath),
    read(
      "../src/features/admin/tournaments/services/adminTournamentTeamService.ts",
    ),
    read(
      "../src/features/admin/tournaments/pages/AdminTournamentTeamsPage.tsx",
    ),
  ]);

  assert.match(migration, /admin_delete_tournament_team/);
  assert.match(
    migration,
    /delete from public\.tournament_teams[\s\S]*where id = target_team\.id/,
  );
  assert.match(migration, /team_deleted_by_admin/);
  assert.match(service, /admin_delete_tournament_team/);
  assert.match(page, /window\.confirm/);
  assert.match(page, /Supprimer définitivement l’équipe/);
  assert.match(page, />\s*Supprimer\s*</);
});

test("le retrait ou la réactivation utilisent aussi le garde-fou des poules", async () => {
  const [migration, service] = await Promise.all([
    read(migrationPath),
    read(
      "../src/features/admin/tournaments/services/adminTournamentTeamService.ts",
    ),
  ]);

  assert.match(migration, /admin_set_tournament_team_status_v2/);
  assert.match(migration, /pools_invalidated_by_team_status_change/);
  assert.match(service, /admin_set_tournament_team_status_v2/);
});
