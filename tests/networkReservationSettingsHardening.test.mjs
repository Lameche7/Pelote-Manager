import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260930094500_harden_club_reservation_settings_access.sql",
    import.meta.url,
  ),
  "utf8",
);

test("les réglages club ne sont plus exposés directement", () => {
  assert.match(
    migration,
    /revoke all on table public\.club_reservation_settings\s+from anon, authenticated/,
  );
});

test("les helpers internes Network ne sont plus des RPC clientes", () => {
  assert.match(
    migration,
    /get_reservation_terms_for_resource[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /is_active_licensee_for_club[\s\S]*from public, anon, authenticated/,
  );
});

test("l'index de la FK updated_by est présent", () => {
  assert.match(
    migration,
    /club_reservation_settings_updated_by_idx[\s\S]*updated_by/,
  );
});
