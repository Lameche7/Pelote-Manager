import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260930093000_drop_legacy_reservation_settings.sql",
    import.meta.url,
  ),
  "utf8",
);
const template = fs.readFileSync(
  new URL(
    "../supabase/instance-template/01_configure_blank_instance.sql",
    import.meta.url,
  ),
  "utf8",
);
const audit = fs.readFileSync(
  new URL(
    "../docs/architecture/PILOTOKI_NETWORK_MIGRATION_AUDIT.md",
    import.meta.url,
  ),
  "utf8",
);

test("le singleton historique Réservations est supprimé", () => {
  assert.match(migration, /drop table public\.reservation_settings/);
  assert.match(migration, /is_active_licensee_for_club/);
});

test("le template neuf configure les réservations par club", () => {
  assert.match(template, /update public\.club_reservation_settings/);
  assert.match(template, /where club_id = target_club_id/);
  assert.doesNotMatch(template, /update public\.reservation_settings/);
});

test("l'audit Network documente le test à deux clubs", () => {
  assert.match(audit, /État de migration — 30 septembre 2026/);
  assert.match(audit, /deuxième club fictif/);
  assert.match(audit, /club_reservation_settings/);
});
