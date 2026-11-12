import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL(
    "../supabase/migrations/20261112190000_can_administer_club_guard.sql",
    import.meta.url,
  ),
  "utf8",
);

test("le contrôle cible un club et une permission explicites", () => {
  assert.match(sql, /create or replace function public\.can_administer_club\(/i);
  assert.match(sql, /target_club_id uuid/i);
  assert.match(sql, /required_permission text/i);
  assert.match(sql, /auth\.uid\(\) is not null/i);
  assert.match(
    sql,
    /public\.has_club_permission\(target_club_id, required_permission\)/i,
  );
});

test("aucune permission anonyme ni élévation super-admin implicite", () => {
  assert.match(sql, /security invoker/i);
  assert.match(
    sql,
    /revoke all on function public\.can_administer_club\(uuid, text\) from anon/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.can_administer_club\(uuid, text\) to authenticated/i,
  );
  assert.doesNotMatch(sql, /service_role|platform_is_admin\s*\(/i);
});
