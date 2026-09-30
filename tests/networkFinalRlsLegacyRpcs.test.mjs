import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260930081500_network_final_rls_legacy_rpcs.sql",
    import.meta.url,
  ),
  "utf8",
);

test("les RLS membres utilisent le résolveur Network", () => {
  assert.match(
    migration,
    /id = public\.profile_club_member_id\(auth\.uid\(\), club_id\)/,
  );
  assert.match(
    migration,
    /club_member_id = public\.profile_club_member_id\(auth\.uid\(\), club_id\)/,
  );
});

test("les RLS de notifications suivent la fiche locale du club", () => {
  assert.match(
    migration,
    /club_member_id =\s*public\.profile_club_member_id\(auth\.uid\(\), club_id\)/,
  );
  assert.match(migration, /communication_deliveries_owner_update/);
});

test("les anciennes RPC licence délèguent au moteur club-scopé", () => {
  assert.match(migration, /from public\.list_my_licence_clubs\(\)/);
  assert.match(migration, /get_my_licence_portal_for_club\(target_club_id\)/);
  assert.match(
    migration,
    /start_my_licence_request_for_club\(\s*target_club_id,\s*payload\s*\)/,
  );
  assert.doesNotMatch(
    migration,
    /select club\.id[\s\S]*from public\.clubs[\s\S]*order by club\.created_at[\s\S]*limit 1/,
  );
});
