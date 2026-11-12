import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(
  new URL("../src/features/admin/components/AdminShell.tsx", import.meta.url),
  "utf8",
);
const access = readFileSync(
  new URL("../src/features/admin/access/adminAccessService.ts", import.meta.url),
  "utf8",
);

test("cross-club business screens are blocked", () => {
  assert.ok(shell.includes("if (requestedClubId) {"));
  assert.ok(shell.includes("Administration inter-clubs en préparation"));
  assert.ok(
    shell.indexOf("if (requestedClubId) {") < shell.indexOf("<Outlet />"),
    "The cross-club guard must precede the business route outlet",
  );
});

test("admin navigation preserves club context", () => {
  assert.ok(shell.includes("encodeURIComponent(requestedClubId)"));
  assert.ok(shell.includes("adminLink(child.to)"));
  assert.ok(shell.includes("adminLink(item.to)"));
});

test("ambiguous multi-club access fails closed", () => {
  assert.ok(access.includes("accesses.length > 1"));
  assert.ok(access.includes("Sélection du club requise"));
  assert.ok(access.includes("access.clubId === clubId"));
});
