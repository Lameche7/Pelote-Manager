import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("nomme explicitement le club à l'inscription", async () => {
  const page = await read("src/features/auth/pages/RegisterPage.tsx");
  assert.match(page, /Avec licence au \{CLUB_CONFIG\.name\}/);
  assert.match(page, /Sans licence au \{CLUB_CONFIG\.name\}/);
});

test("finalise le rattachement licence après confirmation", async () => {
  const [provider, finalization] = await Promise.all([
    read("src/app/providers/AuthProvider.tsx"),
    read("src/features/auth/domain/accountProfileFinalization.ts"),
  ]);

  assert.match(provider, /memberService\.finalizePendingRegistration/);
  assert.match(provider, /finalizePendingMemberRegistration/);
  assert.match(finalization, /if \(currentProfile\.memberId\) return currentProfile/);
  assert.match(finalization, /await finalizePendingMemberRegistration\(\)/);
  assert.match(finalization, /getOrCreateProfile\(user\)/);
});
