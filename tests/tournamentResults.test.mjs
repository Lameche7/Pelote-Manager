import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const migrationPath =
  "../supabase/migrations/20260814130000_add_tournament_result_engine.sql";

test("le Result Engine conserve le score détaillé et les valeurs de classement", async () => {
  const migration = await read(migrationPath);

  assert.match(
    migration,
    /create table if not exists public\.tournament_match_results/,
  );
  assert.match(migration, /score jsonb not null/);
  assert.match(migration, /team_a_points integer not null/);
  assert.match(migration, /team_b_points integer not null/);
  assert.match(migration, /team_a_ranking_points integer not null/);
  assert.match(migration, /team_b_ranking_points integer not null/);
  assert.match(migration, /winner_team_id uuid not null/);
});

test("la validation du score suit les règles sportives configurées", async () => {
  const migration = await read(migrationPath);

  assert.match(
    migration,
    /create or replace function public\.tournament_calculate_match_result/,
  );
  assert.match(migration, /rules\.single_game_points/);
  assert.match(migration, /rules\.main_set_points/);
  assert.match(migration, /rules\.deciding_set_points/);
  assert.match(migration, /rules\.offensive_bonus_points/);
  assert.match(migration, /rules\.defensive_bonus_points/);
  assert.match(
    migration,
    /le vainqueur atteint exactement[\s\S]*strictement en dessous/i,
  );
  assert.match(
    migration,
    /team_a_value = target_points and team_b_value < target_points/,
  );
  assert.match(
    migration,
    /team_b_value = target_points and team_a_value < target_points/,
  );
});

test("un participant ne peut saisir qu'après la fin prévue de sa partie", async () => {
  const migration = await read(migrationPath);

  assert.match(
    migration,
    /create or replace function public\.submit_my_tournament_match_result/,
  );
  assert.match(migration, /current_profile_id uuid := auth\.uid\(\)/);
  assert.match(migration, /tournament_profile_can_score_match/);
  assert.match(migration, /target_planning\.ends_at/);
  assert.match(migration, /select planning\.\*[\s\S]*into target_planning/);
  assert.match(
    migration,
    /select resource\.timezone[\s\S]*into target_timezone/,
  );
  assert.doesNotMatch(migration, /into target_planning,\s*target_timezone/);
  assert.match(
    migration,
    /> now\(\)[\s\S]*cannot be entered before the scheduled end/,
  );
  assert.match(migration, /'pending_validation'/);
});

test("les comptes invités peuvent être rapprochés par l'email inscrit", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /lower\(btrim\(player\.email\)\)/);
  assert.match(migration, /lower\(btrim\(profile\.email\)\)/);
  assert.match(migration, /lower\(btrim\(current_profile_email\)\)/);
});

test("l'administrateur valide, saisit et corrige les résultats", async () => {
  const migration = await read(migrationPath);

  assert.match(
    migration,
    /create or replace function public\.admin_validate_tournament_match_result/,
  );
  assert.match(
    migration,
    /create or replace function public\.admin_save_tournament_match_result/,
  );
  assert.match(migration, /match_result_validated/);
  assert.match(migration, /match_result_corrected_by_admin/);
  assert.match(
    migration,
    /has_club_permission\(target_club_id, 'tournaments\.manage'\)/,
  );
});

test("Mes Tournois et le back-office exposent la saisie de résultat", async () => {
  const [userPage, userService, adminPage, routes, navigation, router] =
    await Promise.all([
      read(
        "../src/features/user-space/tournaments/pages/MyTournamentsPage.tsx",
      ),
      read(
        "../src/features/user-space/tournaments/services/myTournamentsService.ts",
      ),
      read(
        "../src/features/admin/tournaments/pages/AdminTournamentResultsPage.tsx",
      ),
      read("../src/shared/config/routes.ts"),
      read("../src/features/admin/config/adminPermissions.ts"),
      read("../src/app/router.tsx"),
    ]);

  assert.match(userPage, /Saisir le résultat/);
  assert.match(userPage, /Transmettre au club/);
  assert.match(userService, /submit_my_tournament_match_result/);
  assert.match(adminPage, /Valider ce résultat/);
  assert.match(adminPage, /Enregistrer et valider/);
  assert.match(
    routes,
    /adminTournamentResults:\s*"\/admin\/tournois\/resultats"/,
  );
  assert.match(navigation, /label: "Résultats"/);
  assert.match(router, /<AdminTournamentResultsPage \/>/);
});
