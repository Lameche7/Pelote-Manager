import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const sql = readFileSync(
  new URL(
    "../supabase/migrations/20261111180000_tournament_general_ranking_pool_rank_first.sql",
    import.meta.url,
  ),
  "utf8",
);

test("pool rank is primary general ranking key", () => {
  assert.match(sql, /partition by calculated\.pool_number/);
  assert.match(
    sql,
    /row_number\(\) over \(\s*order by\s*calculated\.pool_rank asc,\s*calculated\.ranking_value desc/,
  );
});
test("qualification cutoff ties cannot cross pool ranks", () => {
  assert.match(sql, /count\(\*\) over \(\s*partition by\s*calculated\.pool_rank,/);
  assert.match(sql, /min\(seeded\.seed\) over \(\s*partition by\s*seeded\.pool_rank,/);
  assert.match(sql, /max\(seeded\.seed\) over \(\s*partition by\s*seeded\.pool_rank,/);
});
