import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20261012193000_pool_rankings_use_totals.sql",
  "utf8",
);
const board = readFileSync(
  "src/features/tournaments/components/TournamentResultsBoard.tsx",
  "utf8",
);

test("les poules utilisent les points et la différence de points cumulés", () => {
  assert.match(
    migration,
    /team_stats\.ranking_points::numeric as ranking_value/,
  );
  assert.match(
    migration,
    /team_stats\.points_for - team_stats\.points_against\)::numeric/,
  );
  assert.match(migration, /'ranking_mode', 'total_points'/);
  assert.match(migration, /'goal_average_mode', 'point_difference'/);
  assert.doesNotMatch(
    migration,
    /create or replace function public\.get_tournament_general_rankings/,
  );
});

test("l'affichage des poules expose les totaux, pas les moyennes", () => {
  assert.match(board, /Pts totaux/);
  assert.match(board, /\+\/− total/);
  assert.match(board, /\{team\.rankingPoints\}/);
  assert.match(board, /\{metric\(team\.pointDifference\)\}/);
});
