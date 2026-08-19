import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migrationPath =
  "../supabase/migrations/20260818231500_fix_tournament_result_reminder_archive.sql";

test("archiver un rappel de saisie renseigne archived_at", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /archive_tournament_result_entry_reminders/);
  assert.match(migration, /status\s*=\s*'archived'/);
  assert.match(migration, /archived_at\s*=\s*now\(\)/);
  assert.match(migration, /updated_at\s*=\s*now\(\)/);
});

test("le correctif reste limité aux rappels de résultat publiés du match saisi", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /event\.match_id\s*=\s*new\.match_id/);
  assert.match(migration, /event\.reminder_kind\s*=\s*'result_entry_due'/);
  assert.match(migration, /communication\.status\s*=\s*'published'/);
});
