import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  "tests/sql/admin-dashboard-club-overloads.draft.sql",
  "utf8",
);

const functions = [
  "admin_get_dashboard",
  "admin_dashboard_match_counts",
  "admin_monthly_match_report",
];

test("each new dashboard RPC requires an explicit club", () => {
  for (const name of functions) {
    assert.ok(sql.includes(`FUNCTION public.${name}(target_club_id uuid)`));
    assert.ok(sql.includes(`revoke all on function public.${name}(uuid)`));
    assert.ok(sql.includes(`grant execute on function public.${name}(uuid)`));
  }
});

test("dashboard RPCs never resolve the implicit membership club", () => {
  assert.ok(!sql.includes("admin_current_club_id()"));
  assert.ok(!sql.includes("Trinquet Robert Cathala"));
  assert.ok(sql.includes("resource.club_id = requested_club_id"));
  assert.ok(sql.includes("resource.club_id=requested_club_id"));
  assert.equal((sql.match(/auth\.uid\(\) is null/g) ?? []).length, 3);
  assert.equal((sql.match(/public\.can_read_scoped_club_dashboard\(/g) ?? []).length >= 3, true);
});
