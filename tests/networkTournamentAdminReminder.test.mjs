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

test("le rappel admin résout la fiche locale dans le club du tournoi", () => {
  assert.match(
    migration,
    /public\.profile_club_member_id\(\s*profile\.id,\s*target\.club_id\s*\)/i,
  );
  assert.doesNotMatch(migration, /member\.id = profile\.member_id/i);
});

test("les destinataires restent fondés sur le rôle tournaments.manage du club", () => {
  assert.match(migration, /public\.club_memberships as membership/i);
  assert.match(migration, /permission\.permission_key = 'tournaments\.manage'/i);
  assert.match(migration, /membership\.club_id = target\.club_id/i);
});

test("le rappel conserve son anti-doublon et son audit", () => {
  assert.match(migration, /tournament_admin_reminder_events/i);
  assert.match(migration, /'registrations_closed'/i);
  assert.match(migration, /'tournament_registration_closed'/i);
});
