import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "src/features/admin/services/adminDashboardService.ts",
  "utf8",
);

test("explicit club dashboard sends the same club identifier to all three RPCs", () => {
  const scoped = source.split("const loadExplicitClubDashboard = async (")[1].split("export const adminDashboardService = {")[0];
  assert.ok(scoped.includes("const args = { target_club_id: clubId };"));
  for (const name of [
    "admin_get_dashboard",
    "admin_dashboard_match_counts",
    "admin_monthly_match_report",
  ]) {
    assert.ok(scoped.includes(`"${name}"`));
  }
  assert.ok(!scoped.includes("admin_current_club_id"));
  assert.ok(!scoped.includes("getDashboard()"));
});

test("legacy dashboard stays fail-closed for explicit club requests", () => {
  assert.ok(source.includes("if (clubId) {"));
  assert.ok(source.includes("Tableau de bord inter-clubs indisponible"));
  assert.ok(source.includes("getDashboardForClub: loadExplicitClubDashboard"));
});
