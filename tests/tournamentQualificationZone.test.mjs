import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migrationPath =
  "../supabase/migrations/20260819154500_add_qualification_zone_messages.sql";

test("la zone joueur distingue qualification directe barrage et hors zone", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /tournament_qualification_zone_message/);
  assert.match(migration, /zone de qualification directe/);
  assert.match(migration, /zone des barragistes/);
  assert.match(migration, /hors de la zone qualificative/);
});

test("la frontière des barragistes réutilise la forme générique du tableau", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /tournament_main_bracket_size\(qualifier_count\)/);
  assert.match(migration, /2 \* bracket_size - qualifier_count/);
  assert.match(migration, /direct_qualifier_count \+ 1/);
});

test("le message de zone enrichit le scénario existant sans le remplacer", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /tournament_team_qualification_scenario/);
  assert.match(migration, /jsonb_set\(/);
  assert.match(migration, /\|\| ' ' \|\| coalesce\(scenario->>'message', ''\)/);
});
