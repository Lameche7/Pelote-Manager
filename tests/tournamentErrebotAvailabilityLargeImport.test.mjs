import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260903114500_optimize_large_errebot_availability_import.sql",
    import.meta.url,
  ),
  "utf8",
);

const previewFunction = migration.match(
  /create or replace function public\.admin_preview_errebot_availability_import[\s\S]*?(?=create or replace function public\.admin_import_errebot_availability)/,
)?.[0];

const importFunction = migration.match(
  /create or replace function public\.admin_import_errebot_availability[\s\S]*?(?=revoke all on function public\.validate_errebot_availability_import_payload)/,
)?.[0];

test("le validateur Errebot massif utilise un traitement SQL ensembliste", () => {
  assert.match(migration, /plus de 22 000 disponibilités/);
  assert.match(migration, /with ordinality/);
  assert.match(migration, /row_number\(\) over/);
  assert.match(migration, /jsonb_agg/);
  assert.doesNotMatch(
    migration,
    /for item in select value from jsonb_array_elements\(rows_payload\)/i,
  );
  assert.doesNotMatch(migration, /seen_keys text\[\]/i);
});

test("la prévisualisation ne renvoie plus les milliers de lignes normalisées", () => {
  assert.ok(previewFunction);
  assert.doesNotMatch(previewFunction, /return validation \|\|/);
  assert.doesNotMatch(previewFunction, /'normalized_rows'/);
  assert.match(previewFunction, /'row_count'/);
  assert.match(previewFunction, /'errors'/);
});

test("l application des disponibilités se fait en masse par équipe et par phase", () => {
  assert.ok(importFunction);
  assert.doesNotMatch(
    importFunction,
    /for declaration in select value from jsonb_array_elements\(normalized_declarations\)/i,
  );
  assert.match(
    importFunction,
    /insert into public\.tournament_team_availability_slots[\s\S]*jsonb_array_elements\(normalized_rows\)/,
  );
  assert.match(importFunction, /with phase_state as/);
  assert.match(importFunction, /bool_or\(value->>'phase' = 'pools'\)/);
  assert.match(importFunction, /bool_or\(value->>'phase' = 'finals'\)/);
});
