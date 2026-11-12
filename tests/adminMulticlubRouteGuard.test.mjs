import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(
  "src/features/admin/components/AdminShell.tsx",
  "utf8",
);
const readOnlyDashboard = readFileSync(
  "src/features/admin/components/AdminReadOnlyClubDashboard.tsx",
  "utf8",
);
const dashboard = readFileSync(
  "src/features/admin/pages/AdminPage.tsx",
  "utf8",
);

test("explicit club context blocks legacy admin routes", () => {
  const guard = shell.indexOf("if (requestedClubId) {");
  const outlet = shell.indexOf("<Outlet />");
  assert.ok(guard !== -1, "explicit club guard must exist");
  assert.ok(outlet > guard, "guard must run before rendering admin routes");
  assert.ok(
    shell.includes("Administration inter-clubs en préparation"),
    "blocked state must be visible",
  );
});

test("legacy dashboard never invokes explicit club reads implicitly", () => {
  assert.ok(dashboard.includes("adminDashboardService.getDashboard()"));
  assert.ok(!dashboard.includes("getDashboardForClub("));
});

test("read-only dashboard remains disconnected from legacy admin routes", () => {
  assert.ok(!shell.includes("AdminReadOnlyClubDashboard"));
  assert.ok(readOnlyDashboard.includes("getDashboardForClub(clubId)"));
  assert.ok(!readOnlyDashboard.includes("<Link"));
  assert.ok(!readOnlyDashboard.includes("<Outlet"));
});
