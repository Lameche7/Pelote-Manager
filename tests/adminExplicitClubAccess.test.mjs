import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/features/admin/access/adminAccessService.ts", import.meta.url),
  "utf8",
);

test("un club explicite doit appartenir aux habilitations métier", () => {
  assert.match(source, /async getAccessForClub\(clubId: string\)/);
  assert.match(
    source,
    /accesses\.find\(\(access\) => access\.clubId === clubId\)/,
  );
  assert.match(source, /Aucune habilitation pour le club sélectionné/);
});

test("aucun club n'est choisi implicitement en cas de plusieurs habilitations", () => {
  assert.match(source, /if \(accesses\.length > 1\)/);
  assert.match(source, /Sélection du club requise/);
});
