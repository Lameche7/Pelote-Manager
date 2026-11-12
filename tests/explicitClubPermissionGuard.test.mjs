import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL(
    "../supabase/migrations/20261112180000_explicit_club_permission_guard.sql",
    import.meta.url,
  ),
  "utf8",
);

test("l'autorisation est liée à l'identité Supabase authentifiée", () => {
  assert.match(sql, /auth\.uid\(\) is not null/);
  assert.match(sql, /membership\.profile_id = auth\.uid\(\)/);
  assert.match(sql, /membership\.club_id = target_club_id/);
  assert.match(sql, /permission\.permission_key = required_permission/);
});

test("aucun accès anonyme à la fonction de contrôle", () => {
  assert.match(
    sql,
    /revoke all on function public\.my_club_has_permission\(uuid, text\) from anon/,
  );
  assert.match(
    sql,
    /grant execute on function public\.my_club_has_permission\(uuid, text\) to authenticated/,
  );
});
