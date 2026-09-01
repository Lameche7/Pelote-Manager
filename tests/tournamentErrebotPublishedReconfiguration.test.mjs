import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260901160000_reconfigure_published_errebot_tournament.sql",
    import.meta.url,
  ),
  "utf8",
);

test("un import Errebot déjà publié est retiré du calendrier avant reconfiguration", () => {
  assert.match(migration, /^begin;/m);
  assert.match(
    migration,
    /rename to admin_import_errebot_tournament_configured_core/,
  );
  assert.match(migration, /existing_tournament_status = 'planning_published'/);
  assert.match(migration, /admin_unpublish_tournament_planning\(existing_tournament_id\)/);
  assert.match(
    migration,
    /admin_import_errebot_tournament_configured_core\(payload\)/,
  );
  assert.match(migration, /planningWasUnpublished/);
  assert.match(
    migration,
    /grant execute on function public\.admin_import_errebot_tournament_configured\(jsonb\)\s+to authenticated/,
  );
  assert.match(migration, /commit;\s*$/);
});

test("les autres états avancés restent verrouillés", () => {
  assert.match(
    migration,
    /existing_tournament_status <> 'planning_generated'/,
  );
  assert.match(
    migration,
    /Imported Errebot tournament options are locked after publication/,
  );
});
