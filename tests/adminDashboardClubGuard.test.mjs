import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(
  "src/features/admin/services/adminDashboardService.ts",
  "utf8",
);

test("explicit cross-club dashboard requests fail closed", () => {
  assert.ok(dashboard.includes("async getDashboard(clubId?: string)"));
  assert.ok(dashboard.includes("if (clubId) {"));
  assert.ok(dashboard.includes("isolation des données non validée"));
});

test("legacy dashboard RPCs remain identified for server-side scoping", () => {
  assert.ok(dashboard.includes('"admin_get_dashboard"'));
  assert.ok(dashboard.includes('"admin_dashboard_match_counts"'));
  assert.ok(dashboard.includes('"admin_monthly_match_report"'));
});
