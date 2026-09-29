import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(new URL("../supabase/migrations/20260929210000_use_network_identity_for_reservation_release_notifications.sql", import.meta.url),"utf8");

test("les notifications de créneaux libérés remontent du membre local au profil Network", () => {
  assert.equal((migration.match(/club_member_profile_id\(member\.id\)/g) ?? []).length, 2);
  assert.doesNotMatch(migration, /profile\.member_id\s*=\s*member\.id/);
});

test("les deux publications restent limitées au club du créneau", () => {
  assert.match(migration, /member\.club_id=resource_row\.club_id/);
  assert.match(migration, /member\.club_id=target\.club_id/);
});
