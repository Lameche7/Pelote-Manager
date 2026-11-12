import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL(
    "../src/features/admin/access/adminAccessService.ts",
    import.meta.url,
  ),
  "utf8",
);

test("les clubs administrables proviennent de la RPC authentifiée", () => {
  assert.match(source, /async listAuthorizedClubs\(\)/);
  assert.match(source, /supabase\.rpc\("get_my_club_access"\)/);
});

test("plusieurs clubs ne donnent pas un accès arbitraire au premier club", () => {
  assert.match(source, /if \(accesses\.length > 1\)/);
  assert.match(source, /Sélection du club requise/);
});

const provider = readFileSync(
  new URL(
    "../src/features/admin/access/AdminAccessProvider.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("le contexte admin vérifie le club explicitement demandé auprès de la RPC", () => {
  assert.match(provider, /get\("adminClubId"\)/);
  assert.match(provider, /getOptionalAccess\(requestedClubId \?\? undefined\)/);
  assert.match(provider, /\[requestedClubId\]/);
});

test("un changement de club efface immédiatement les anciennes permissions", () => {
  assert.match(provider, /setAccess\(null\);/);
  assert.match(provider, /setError\(null\);/);
  assert.match(provider, /setIsLoading\(true\);/);
});

const shell = readFileSync(
  new URL("../src/features/admin/components/AdminShell.tsx", import.meta.url),
  "utf8",
);

test("les liens du back-office conservent le club choisi", () => {
  assert.match(shell, /const adminLink = \(path: string\)/);
  assert.match(shell, /to=\{adminLink\(child\.to\)\}/);
  assert.match(shell, /to=\{adminLink\(item\.to\)\}/);
});

test("changer de club remonte le contexte et ne conserve pas les droits précédents", () => {
  assert.match(shell, /<AdminAccessProvider key=\{requestedClubId\}>/);
});
