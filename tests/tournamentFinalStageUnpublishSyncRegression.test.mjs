import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../supabase/migrations/20260822103300_fix_final_stage_unpublish_event_sync.sql",
  import.meta.url,
);

test("le retrait final synchronise l Event Engine avec l UUID de l événement", async () => {
  const sql = await readFile(migration, "utf8");

  assert.match(sql, /admin_unpublish_tournament_final_round/);
  assert.match(
    sql,
    /archived_at = coalesce\(event\.archived_at, now\(\)\)/,
  );
  assert.match(sql, /sync_event_occupations\(item\.event_id\)/);
  assert.doesNotMatch(sql, /sync_event_occupations\(saved_event\)/);
});
