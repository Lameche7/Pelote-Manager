import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260930004500_network_admin_events_communications.sql",
    import.meta.url,
  ),
  "utf8",
);

test("les responsables d'événement passent par l'identité Network", () => {
  assert.match(
    migration,
    /club_member_profile_id\(members\.id\)/,
  );
  assert.match(
    migration,
    /profile_club_member_id\(profile\.id, event\.club_id\)/,
  );
  assert.match(
    migration,
    /profile_club_member_id\(responsible, club\) is null/,
  );
});

test("la publication de communication rattache la fiche locale au compte global", () => {
  assert.match(
    migration,
    /profiles\.id = public\.club_member_profile_id\(members\.id\)/,
  );
  assert.doesNotMatch(
    migration,
    /profiles\.member_id = members\.id/,
  );
});

test("les statistiques de communication reconnaissent les comptes multi-clubs", () => {
  assert.match(
    migration,
    /club_member_profile_id\(deliveries\.club_member_id\)/,
  );
  assert.match(migration, /in_app_recipients/);
  assert.match(migration, /without_account/);
});

test("les RPC admin restent limitées aux utilisateurs authentifiés", () => {
  for (const fn of [
    "admin_list_event_responsibles",
    "admin_list_events",
    "admin_save_event",
    "admin_publish_communication",
    "admin_list_communications",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `revoke all on function public\\.${fn}[^;]*[\\s\\S]*?from public, anon, authenticated`,
      ),
    );
  }
});
