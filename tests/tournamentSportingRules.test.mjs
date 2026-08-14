import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migrationPath =
  "../supabase/migrations/20260814114500_add_tournament_sporting_rules.sql";

test("les règles sportives sont structurées et auditées", async () => {
  const migration = await read(migrationPath);

  assert.match(
    migration,
    /create table if not exists public\.tournament_sporting_rules/,
  );
  assert.match(migration, /'single_game'/);
  assert.match(migration, /'best_of_three_sets'/);
  assert.match(migration, /base_win_points integer not null default 3/);
  assert.match(migration, /base_loss_points integer not null default 1/);
  assert.match(migration, /offensive_bonus_points integer not null default 1/);
  assert.match(migration, /defensive_bonus_points integer not null default 1/);
  assert.match(migration, /ranking_mode public\.tournament_ranking_mode/);
  assert.match(
    migration,
    /goal_average_mode public\.tournament_goal_average_mode/,
  );
  assert.match(migration, /sporting_rules_updated/);
});

test("les règles restent modifiables jusqu'à la validation des poules", async () => {
  const migration = await read(migrationPath);

  assert.match(
    migration,
    /target_tournament\.status not in \([\s\S]*'registrations_closed'[\s\S]*'pools_generated'/,
  );
  assert.doesNotMatch(
    migration,
    /target_tournament\.status not in \([\s\S]*'pools_validated'/,
  );
  assert.match(migration, /Tournament sporting rules are locked at this stage/);
});

test("l'administration expose les deux formats, les bonus et le classement par partie", async () => {
  const [section, page, service] = await Promise.all([
    read(
      "../src/features/admin/tournaments/components/TournamentSportingRulesSection.tsx",
    ),
    read("../src/features/admin/tournaments/pages/AdminTournamentsPage.tsx"),
    read(
      "../src/features/admin/tournaments/services/tournamentAdminService.ts",
    ),
  ]);

  assert.match(section, /2 manches gagnantes/);
  assert.match(section, /Une seule partie/);
  assert.match(section, /Points des manches principales/);
  assert.match(section, /Points de la manche décisive/);
  assert.match(section, /Seuil bonus offensif/);
  assert.match(section, /Seuil bonus défensif/);
  assert.match(section, /Points de classement \/ partie/);
  assert.match(section, /Différence de points \/ partie/);
  assert.match(section, /victoire 2–0/);
  assert.match(section, /défaite 1–2/);

  assert.match(page, /TournamentSportingRulesSection/);
  assert.match(page, /saveSportingRules/);
  assert.match(service, /getSportingRules/);
  assert.match(service, /saveSportingRules/);
});
