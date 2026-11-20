import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(
  "src/features/admin/components/AdminShell.tsx",
  "utf8",
);
const access = readFileSync(
  "src/features/admin/access/adminAccessService.ts",
  "utf8",
);

test("cross-club access is guarded", () => {
  assert.ok(shell.includes("if (requestedClubId) {"));
  assert.ok(shell.includes("Administration inter-clubs en préparation"));
  assert.ok(
    shell.indexOf("if (requestedClubId) {") < shell.indexOf("<Outlet />"),
  );
  assert.ok(shell.includes('params.set("adminClubId", requestedClubId)'));
  assert.ok(shell.includes("adminLink(child.to)"));
  assert.ok(shell.includes("adminLink(item.to)"));
  assert.ok(access.includes("accesses.length > 1"));
  assert.ok(access.includes("Sélection du club requise"));
  assert.ok(access.includes("access.clubId === clubId"));
});
