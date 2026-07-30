import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { finalizeAccountProfile } from "../.test-dist/src/features/auth/domain/accountProfileFinalization.js";

const authProviderSource = readFileSync(
  "src/app/providers/AuthProvider.tsx",
  "utf8",
);

test("crée le profil visiteur à la première connexion après confirmation email", async () => {
  const confirmedVisitor = { id: "visitor-id", email: "visiteur@example.fr" };
  const profile = {
    id: confirmedVisitor.id,
    email: confirmedVisitor.email,
    role: "visitor",
    createdAt: "2026-07-30T10:00:00Z",
    updatedAt: "2026-07-30T10:00:00Z",
  };
  const calls = [];

  const finalized = await finalizeAccountProfile(
    confirmedVisitor,
    async (user) => {
      calls.push(user);
      return profile;
    },
  );

  assert.deepEqual(calls, [confirmedVisitor]);
  assert.equal(finalized, profile);
});

test("bloque la finalisation de connexion si le profil ne peut pas être créé", async () => {
  const confirmedVisitor = { id: "visitor-id", email: "visiteur@example.fr" };

  await assert.rejects(
    finalizeAccountProfile(confirmedVisitor, async () => {
      throw new Error("création du profil impossible");
    }),
    /création du profil impossible/,
  );
});

test("la première connexion attend obligatoirement la finalisation du profil", () => {
  assert.match(
    authProviderSource,
    /await synchronize\(authenticatedUser, true\)/,
  );
});
