import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const sql = readFileSync(
  new URL(
    "../supabase/migrations/20261111210000_tournament_general_ranking_official_pool_positions.sql",
    import.meta.url,
  ),
  "utf8",
);

test("general ranking uses the actual displayed pool positions", () => {
  assert.match(sql, /public\.get_tournament_rankings\(target_tournament_id\)/);
  assert.match(sql, /team\.value->>'position'/);
  assert.match(sql, /official\.pool_rank/);
  assert.doesNotMatch(sql, /dense_rank\(\)/i);
});

test("series is scoped and official positions are joined by team", () => {
  assert.match(sql, /series\.value->>'id'\)::uuid = target_series_id/);
  assert.match(sql, /official\.team_id = calculated\.team_id/);
});
