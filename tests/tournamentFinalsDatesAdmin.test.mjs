import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("les admins peuvent définir les dates finales après génération des poules", async () => {
  const [migration, page, service] = await Promise.all([
    read("../supabase/migrations/20261103190000_admin_edit_tournament_finals_dates.sql"),
    read("../src/features/admin/tournaments/pages/AdminTournamentQualificationPage.tsx"),
    read("../src/features/admin/tournaments/services/tournamentAdminService.ts"),
  ]);

  assert.match(migration, /create or replace function public\.admin_set_tournament_finals_dates/);
  assert.match(migration, /has_club_permission\(target_club_id, 'tournaments\.manage'\)/);
  assert.match(migration, /tournament\.club_id = target_club_id/);
  assert.match(migration, /target_finals_starts_on <= target_tournament\.pool_ends_on/);
  assert.match(migration, /tournament_final_planning_nodes/);
  assert.match(migration, /tournament_match_planning/);
  assert.match(migration, /tournament_team_availability_slots/);
  assert.match(migration, /tournament_audit_log/);
  assert.match(service, /admin_set_tournament_finals_dates/);
  assert.match(page, /Dates de la phase finale/);
  assert.match(page, /Enregistrer les dates de phase finale/);
  assert.match(page, /tournamentAdminService\.setFinalsDates/);
});
