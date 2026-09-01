import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260901154500_errebot_import_tournament_options.sql",
    import.meta.url,
  ),
  "utf8",
);
const legacyMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260901143000_errebot_transactional_tournament_import.sql",
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
const service = readFileSync(
  new URL(
    "../src/features/admin/tournaments/services/errebotImportService.ts",
    import.meta.url,
  ),
  "utf8",
);
const finalize = readFileSync(
  new URL(
    "../src/features/admin/tournaments/components/ErrebotTournamentImportFinalize.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("l'import configuré applique les règles et reste réutilisable sur un fichier déjà importé", () => {
  assert.match(migration, /^begin;/m);
  assert.match(
    migration,
    /admin_import_errebot_tournament_configured\(\s*payload jsonb/,
  );
  assert.match(migration, /admin_import_errebot_tournament\(legacy_payload\)/);
  assert.match(migration, /status <> 'planning_generated'/);
  assert.match(migration, /update public\.tournament_sporting_rules/);
  assert.match(migration, /errebot_options_configured/);
  assert.match(
    migration,
    /grant execute on function public\.admin_import_errebot_tournament_configured\(jsonb\)\s+to authenticated/,
  );
  assert.match(migration, /commit;\s*$/);
});

test("les terrains et la durée du planning sont explicitement reconfigurés", () => {
  assert.match(migration, /input_resource_ids/);
  assert.match(migration, /input_primary_resource_id/);
  assert.match(migration, /delete from public\.tournament_resources/);
  assert.match(migration, /insert into public\.tournament_resources/);
  assert.match(migration, /update public\.tournament_match_planning/);
  assert.match(migration, /slot_duration_minutes = input_slot_duration/);
  assert.match(migration, /delete from public\.tournament_play_windows/);
});

test("le navigateur n'envoie plus de format sportif implicite", () => {
  assert.match(helper, /resourceIds: string\[\]/);
  assert.match(helper, /primaryResourceId: string/);
  assert.match(
    helper,
    /sportingRules: ErrebotTournamentSportingRulesSelection/,
  );
  assert.match(helper, /matchFormat: ErrebotTournamentMatchFormat/);
  assert.match(service, /admin_import_errebot_tournament_configured/);
  assert.match(finalize, /Choisir le format…/);
  assert.match(finalize, /Une partie en X points/);
  assert.match(finalize, /2 manches gagnantes/);
  assert.match(finalize, /Durée d’un créneau/);
  assert.match(finalize, /Terrains du tournoi|2\. Terrains/);
  assert.match(finalize, /Terrain utilisé par le planning importé/);
});

test("un PDF déjà importé corrige ses options sans créer de doublon", () => {
  assert.match(
    finalize,
    /aucun doublon n’a été créé et les options du tournoi existant ont été mises à jour/,
  );
  assert.match(legacyMigration, /alreadyImported', true/);
  assert.match(legacyMigration, /source_file_hash = input_file_hash/);
  assert.match(migration, /admin_import_errebot_tournament\(legacy_payload\)/);
});
