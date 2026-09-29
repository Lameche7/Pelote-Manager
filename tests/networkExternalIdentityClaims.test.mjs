import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260929100000_use_network_identity_for_external_claims.sql",
    import.meta.url,
  ),
  "utf8",
);

test("le claim résout l'adhésion locale du club du tournoi", () => {
  assert.match(
    migration,
    /target_member_id := public\.profile_club_member_id\(\s*current_profile\.id,\s*target_club_id\s*\)/i,
  );
  assert.match(
    migration,
    /member_id = coalesce\(identity\.member_id, target_member_id\)/i,
  );
  assert.doesNotMatch(
    migration,
    /member_id = coalesce\(identity\.member_id, current_profile\.member_id\)/i,
  );
});

test("le claim refuse une identité externe couvrant plusieurs clubs", () => {
  assert.match(
    migration,
    /having count\(distinct tournament\.club_id\) = 1/i,
  );
  assert.match(migration, /External participation club is ambiguous/i);
});

test("le trigger accepte un membre local portant la même identité sportive globale", () => {
  assert.match(
    migration,
    /target_member\.sport_player_id = target_profile\.sport_player_id/i,
  );
  assert.match(
    migration,
    /target_profile\.sport_player_id is null[\s\S]*target_profile\.member_id = target_member\.id/i,
  );
});

test("les protections récentes des remplacements administrateur sont conservées", () => {
  assert.match(migration, /target_identity\.source = 'admin_replacement'/i);
  assert.match(migration, /auth_user\.email_confirmed_at is not null/i);
  assert.match(migration, /self_email_name_confirmation/i);
});
