import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260903123500_compact_errebot_availability_payload.sql",
    import.meta.url,
  ),
  "utf8",
);
const service = readFileSync(
  new URL(
    "../src/features/admin/tournaments/services/adminErrebotAvailabilityImportService.ts",
    import.meta.url,
  ),
  "utf8",
);

test("les disponibilités Errebot massives transitent groupées par équipe", () => {
  assert.match(service, /availability_by_team/);
  assert.match(service, /source_slot_ids/);
  assert.match(service, /admin_preview_errebot_availability_import_compact/);
  assert.match(service, /admin_import_errebot_availability_compact/);
  assert.match(service, /legacyPayload/);
});

test("Supabase reconstruit les lignes détaillées côté base", () => {
  assert.match(
    migration,
    /create or replace function public\.expand_errebot_availability_compact_payload/,
  );
  assert.match(migration, /jsonb_array_elements_text/);
  assert.match(migration, /source_slot_id = selected_slot\.source_slot_id/);
  assert.match(
    migration,
    /public\.admin_preview_errebot_availability_import\(/,
  );
  assert.match(migration, /public\.admin_import_errebot_availability\(/);
});
