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

test("cross-club business screens remain blocked until server-side scoping is implemented", () => {
  assert.match(shell, /if \(requestedClubId\) \{/);
  assert.match(shell, /Administration inter-clubs en préparation/);
  assert.ok(
    shell.indexOf("if (requestedClubId) {") < shell.indexOf("<Outlet />"),
    "The cross-club guard must precede the business route outlet",
  );
});

test("admin navigation preserves explicit club context", () => {
  assert.match(shell, /adminClubId=\$\{encodeURIComponent\(requestedClubId\)\}/);
  assert.match(shell, /to=\{adminLink\(child\.to\)\}/);
  assert.match(shell, /to=\{adminLink\(item\.to\)\}/);
});

test("ambiguous multi-club access fails closed", () => {
  assert.match(access, /if \(accesses\.length > 1\)/);
  assert.match(access, /Sélection du club requise/);
  assert.match(
    access,
    /accesses\.find\(\(access\) => access\.clubId === clubId\)/,
  );
});
