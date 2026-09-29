import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260929130000_use_network_identity_for_tournament_admin_reminder.sql",
    import.meta.url,
  ),
  "utf8",
);

test("résout la fiche locale du club du tournoi", () => {
  const resolver =
    /public\.profile_club_member_id\(\s*profile\.id,\s*target\.club_id\s*\)/i;

  assert.match(migration, resolver);
  assert.doesNotMatch(migration, /member\.id = profile\.member_id/i);
});

test("conserve les droits tournaments.manage du club", () => {
  const permission = /permission\.permission_key = 'tournaments\.manage'/i;

  assert.match(migration, /public\.club_memberships as membership/i);
  assert.match(migration, permission);
  assert.match(migration, /membership\.club_id = target\.club_id/i);
});

test("conserve l'anti-doublon et l'audit", () => {
  assert.match(migration, /tournament_admin_reminder_events/i);
  assert.match(migration, /'registrations_closed'/i);
  assert.match(migration, /'tournament_registration_closed'/i);
});
