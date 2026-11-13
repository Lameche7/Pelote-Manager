import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const leaseService = readFileSync(
  "src/features/platform/services/platformAdminLeaseService.ts",
  "utf8",
);
const shell = readFileSync(
  "src/features/admin/components/AdminShell.tsx",
  "utf8",
);

test("lease issuance requires both authenticated sessions", () => {
  assert.ok(leaseService.includes("if (!platformToken || !businessToken)"));
  assert.ok(leaseService.includes("X-Business-Authorization"));
});

test("lease expiry is checked before granting local access", () => {
  assert.ok(leaseService.includes("Date.parse(data.expiresAt)"));
  assert.ok(leaseService.includes("remainingMs <= 0"));
  assert.ok(leaseService.includes("remainingMs > 15 * 60 * 1000"));
  assert.ok(leaseService.includes("Number.isFinite(expiresAt)"));
});

test("explicit club routes remain blocked without validated rollout", () => {
  assert.ok(shell.includes("if (requestedClubId) {"));
  assert.ok(!shell.includes("platformAdminLeaseService.issue("));
});

const leaseMigration = readFileSync(
  "tests/sql/platform-admin-short-lived-leases.draft.sql",
  "utf8",
);
const scopedDashboardSql = readFileSync(
  "tests/sql/admin-dashboard-club-overloads.draft.sql",
  "utf8",
);

test("lease preserves legacy club permissions", () => {
  assert.ok(
    !/create or replace function public\.has_club_permission\s*\(/i.test(
      leaseMigration,
    ),
  );
  assert.ok(
    !/create or replace function public\.get_my_club_access\s*\(/i.test(
      leaseMigration,
    ),
  );
  assert.ok(leaseMigration.includes("public.can_read_scoped_club_dashboard"));
  assert.ok(
    leaseMigration.includes(
      "pilotoki_private.has_active_platform_lease(auth.uid())",
    ),
  );
});

test("scoped dashboards use read-only guard", () => {
  for (const name of [
    "admin_get_dashboard",
    "admin_dashboard_match_counts",
    "admin_monthly_match_report",
  ]) {
    assert.ok(scopedDashboardSql.includes(`public.${name}(target_club_id uuid)`));
  }
  const guardCalls = scopedDashboardSql.match(/can_read_scoped_club_dashboard/g);
  assert.ok((guardCalls?.length ?? 0) >= 3);
  assert.ok(
    !scopedDashboardSql.includes(
      "public.has_club_permission(requested_club_id, 'admin.dashboard.read')",
    ),
  );
});
