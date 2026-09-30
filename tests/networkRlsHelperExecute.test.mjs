import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260930083000_allow_network_rls_helper.sql",
    import.meta.url,
  ),
  "utf8",
);

test("le helper RLS Network est réservé aux utilisateurs authentifiés", () => {
  assert.match(
    migration,
    /revoke all on function public\.profile_club_member_id\(uuid, uuid\)[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /grant execute on function public\.profile_club_member_id\(uuid, uuid\)[\s\S]*to authenticated/,
  );
});
