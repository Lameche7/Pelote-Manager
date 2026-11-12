import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("le sélecteur vérifie la liste des habilitations, sans accès implicite", () => {
 const source = readFileSync(new URL("../src/features/admin/access/clubSelection.ts", import.meta.url), "utf8");
 assert.match(source, /accesses\.find\(\(access\) => access\.clubId === requestedClubId\)/);
 assert.match(source, /\?\? null/);
 assert.match(source, /accesses\.length === 1 \? accesses\[0\] : null/);
});
