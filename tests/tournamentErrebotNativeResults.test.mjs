import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260901163000_errebot_native_results_and_rankings.sql",
    import.meta.url,
  ),
  "utf8",
);

test("les scores Errebot en partie unique passent par le Result Engine natif", () => {
  assert.match(migration, /sync_errebot_single_game_results/);
  assert.match(migration, /rules\.match_format <> 'single_game'/);
  assert.match(migration, /rules\.single_game_points/);
  assert.match(migration, /tournament_calculate_match_result/);
  assert.match(migration, /'team_a', source_fixture\.source_score_a/);
  assert.match(migration, /'team_b', source_fixture\.source_score_b/);
  assert.match(migration, /'validated'/);
  assert.match(migration, /team_a_ranking_points/);
  assert.match(migration, /team_b_ranking_points/);
});

test("un résultat natif existant n'est jamais écrasé par Errebot", () => {
  assert.match(
    migration,
    /not exists \([\s\S]*tournament_match_results[\s\S]*existing_result\.match_id = fixture\.match_id/,
  );
  assert.match(migration, /on conflict \(match_id\) do nothing/);
});

test("les scores incomplets ou incompatibles avec la cible restent de la provenance", () => {
  assert.match(migration, /fixture\.source_score_a is not null/);
  assert.match(migration, /fixture\.source_score_b is not null/);
  assert.match(
    migration,
    /fixture\.source_score_a = rules\.single_game_points/,
  );
  assert.match(
    migration,
    /fixture\.source_score_b = rules\.single_game_points/,
  );
});

test("les imports futurs et les tournois Errebot déjà configurés sont synchronisés", () => {
  assert.match(
    migration,
    /admin_import_errebot_tournament_configured_core\(payload\)/,
  );
  assert.match(migration, /'promotedResultCount'/);
  assert.match(migration, /Rattrapage des tournois Errebot déjà configurés/);
  assert.match(migration, /rules\.match_format = 'single_game'/);
  assert.match(migration, /^begin;/m);
  assert.match(migration, /commit;\s*$/);
});
