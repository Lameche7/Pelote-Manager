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
  assert.ok(leaseService.includes("expiresAt <= Date.now()"));
  assert.ok(leaseService.includes("Number.isFinite(expiresAt)"));
});

test("explicit club routes remain blocked without validated rollout", () => {
  assert.ok(shell.includes("if (requestedClubId) {"));
  assert.ok(!shell.includes("platformAdminLeaseService.issue("));
});
