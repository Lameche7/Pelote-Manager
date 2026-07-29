import assert from "node:assert/strict";
import test from "node:test";
import {
  completeMemberRegistration,
  mapRegistrationError,
} from "../.test-dist/src/features/members/domain/memberRegistration.js";

test("traduit les erreurs sans exposer les messages techniques", () => {
  assert.equal(
    mapRegistrationError(new Error("User already registered")).registrationCode,
    "email_already_used",
  );
  assert.equal(
    mapRegistrationError(Object.assign(new Error("raw sql"), { code: "23505" }))
      .registrationCode,
    "licence_already_linked",
  );
  assert.equal(
    mapRegistrationError(new Error("Password should be at least 8 chars"))
      .registrationCode,
    "weak_password",
  );
  assert.equal(
    mapRegistrationError(Object.assign(new Error("raw sql"), { code: "P0002" }))
      .registrationCode,
    "identity_not_found",
  );
});

test("crée le profil puis réalise la liaison automatique", async () => {
  const calls = [];
  await completeMemberRegistration(
    async () => {
      calls.push("profile");
    },
    async () => {
      calls.push("link");
    },
    async () => {
      calls.push("rollback");
    },
  );
  assert.deepEqual(calls, ["profile", "link"]);
});

test("supprime le compte si la liaison échoue afin de ne laisser aucun orphelin", async () => {
  const calls = [];
  await assert.rejects(
    completeMemberRegistration(
      async () => {
        calls.push("profile");
      },
      async () => {
        calls.push("link");
        throw Object.assign(new Error("linked"), { code: "23505" });
      },
      async () => {
        calls.push("rollback");
      },
    ),
    (error) => error.registrationCode === "licence_already_linked",
  );
  assert.deepEqual(calls, ["profile", "link", "rollback"]);
});
