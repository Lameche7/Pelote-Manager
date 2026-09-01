import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260901143000_errebot_transactional_tournament_import.sql",
    import.meta.url,
  ),
  "utf8",
);
const service = readFileSync(
  new URL(
    "../src/features/admin/tournaments/services/errebotImportService.ts",
    import.meta.url,
  ),
  "utf8",
);
const helper = readFileSync(
  new URL(
    "../src/features/admin/tournaments/domain/errebotTransactionalImport.ts",
    import.meta.url,
  ),
  "utf8",
);
const page = readFileSync(
  new URL(
    "../src/features/admin/tournaments/pages/AdminTournamentImportPage.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("l'import Errebot est une RPC contrôlée et transactionnelle", () => {
  assert.match(migration, /^begin;/m);
  assert.match(
    migration,
    /create or replace function public\.admin_import_errebot_tournament\(payload jsonb\)/,
  );
  assert.match(
    migration,
    /has_club_permission\(target_club_id, 'tournaments\.manage'\)/,
  );
  assert.match(migration, /source_file_hash = input_file_hash/);
  assert.match(migration, /alreadyImported', true/);
  assert.match(migration, /expected_fixture_count <> fixture_count/);
  assert.match(migration, /tournament_pools_are_complete/);
  assert.match(migration, /status = 'planning_generated'/);
  assert.match(migration, /source,\s*updated_at[\s\S]*?'manual'/);
  assert.match(migration, /commit;\s*$/);
});

test("l'import conserve la provenance sans inventer de résultats sportifs", () => {
  assert.match(migration, /create table public\.tournament_import_pool_refs/);
  assert.match(
    migration,
    /create table public\.tournament_import_fixture_refs/,
  );
  assert.match(migration, /source_score_a/);
  assert.match(migration, /source_score_b/);
  assert.doesNotMatch(
    migration,
    /insert into public\.tournament_match_results/i,
  );
  assert.match(migration, /@pelote-manager\.invalid/);
});

test("les tables de provenance restent privées", () => {
  assert.match(
    migration,
    /tournament_import_pool_refs enable row level security/,
  );
  assert.match(
    migration,
    /tournament_import_fixture_refs enable row level security/,
  );
  assert.match(
    migration,
    /revoke all on table public\.tournament_import_fixture_refs\s+from public, anon, authenticated/,
  );
});

test("le navigateur n'envoie que le résultat structuré du parseur", () => {
  assert.match(helper, /teams: parsed\.teams/);
  assert.match(helper, /pools: parsed\.pools/);
  assert.match(helper, /fixtures: parsed\.fixtures/);
  assert.doesNotMatch(helper, /excerpt|sourceText|extracted\.text|pdfText/);
  assert.match(service, /admin_import_errebot_tournament/);
});

test("l'assistant expose une cinquième étape d'import explicite", () => {
  assert.match(page, /"Import"/);
  assert.match(page, /Préparer l’import/);
  assert.match(page, /ErrebotTournamentImportFinalize/);
});
