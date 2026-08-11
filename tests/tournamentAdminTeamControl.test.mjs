import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migrationPath =
  "../supabase/migrations/20260811133500_restore_admin_tournament_team_control.sql";
const memberLookupMigrationPath =
  "../supabase/migrations/20260811145500_admin_tournament_member_lookup_and_player_contacts.sql";

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

test("l'ajout admin recherche les licenciés disponibles du club", async () => {
  const [migration, service, playerFields] = await Promise.all([
    read(memberLookupMigrationPath),
    read(
      "../src/features/admin/tournaments/services/adminTournamentTeamService.ts",
    ),
    read(
      "../src/features/admin/tournaments/components/AdminTournamentPlayerFields.tsx",
    ),
  ]);

  assert.match(migration, /admin_search_tournament_members/);
  assert.match(migration, /member\.is_active/);
  assert.match(migration, /existing_team\.status in \('pending', 'accepted'\)/);
  assert.match(migration, /has_club_permission[\s\S]*tournaments\.manage/);
  assert.match(migration, /member_result record/);
  assert.match(migration, /into member_result/);
  assert.match(migration, /if not found then/);
  assert.doesNotMatch(migration, /into\s+member_row\s*,/);
  assert.match(service, /admin_search_tournament_members/);
  assert.match(playerFields, /Rechercher un licencié du club/);
  assert.match(playerFields, /Récupéré depuis la fiche licencié/);
  assert.match(playerFields, /memberId: member\.id/);
});

test("les coordonnées d'équipe sont dérivées des joueurs et ne sont plus saisies en double", async () => {
  const [migration, service, page] = await Promise.all([
    read(memberLookupMigrationPath),
    read(
      "../src/features/admin/tournaments/services/adminTournamentTeamService.ts",
    ),
    read(
      "../src/features/admin/tournaments/pages/AdminTournamentTeamsPage.tsx",
    ),
  ]);

  assert.match(migration, /admin_save_tournament_team_v5/);
  assert.match(migration, /'contact_email', derived_email/);
  assert.match(migration, /'contact_phone', derived_phone/);
  assert.match(migration, /Tournament player contacts are incomplete/);
  assert.match(service, /admin_save_tournament_team_v5/);
  assert.match(service, /admin_list_tournament_teams_v3/);
  assert.doesNotMatch(page, /E-mail de contact/);
  assert.doesNotMatch(page, /Téléphone de contact/);
  assert.match(page, /Coordonnées joueurs/);
});
