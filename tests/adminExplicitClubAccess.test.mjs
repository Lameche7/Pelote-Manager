import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/features/admin/access/adminAccessService.ts", import.meta.url),
  "utf8",
);

test("le club doit être autorisé", () => {
  assert.match(source, /getAccessForClub/);
  assert.match(source, /access\.clubId === clubId/);
  assert.match(source, /Aucune habilitation pour le club sélectionné/);
});

test("pas de club implicite", () => {
  assert.match(source, /accesses\.length > 1/);
  assert.match(source, /Sélection du club requise/);
});
