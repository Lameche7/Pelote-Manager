import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  completeMemberRegistrationWithCleanup,
  getRegistrationOutcome,
  VerificationAttemptLimiter,
  mapRegistrationError,
} from "../.test-dist/src/features/members/domain/memberRegistration.js";
import { canCleanupMemberRegistration } from "../.test-dist/supabase/functions/_shared/memberRegistrationCleanup.js";

const profileMigration = await readFile(
  new URL(
    "../supabase/migrations/20260728000000_create_profiles.sql",
    import.meta.url,
  ),
  "utf8",
);
const cleanupFunction = await readFile(
  new URL(
    "../supabase/functions/cleanup-member-registration/index.ts",
    import.meta.url,
  ),
  "utf8",
);

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
  await completeMemberRegistrationWithCleanup(
    async () => {
      calls.push("profile");
    },
    async () => {
      calls.push("link");
    },
    async () => {
      calls.push("cleanup");
    },
  );
  assert.deepEqual(calls, ["profile", "link"]);
});

test("supprime le compte si la liaison échoue afin de ne laisser aucun orphelin", async () => {
  const calls = [];
  await assert.rejects(
    completeMemberRegistrationWithCleanup(
      async () => {
        calls.push("profile");
      },
      async () => {
        calls.push("link");
        throw Object.assign(new Error("linked"), { code: "23505" });
      },
      async () => {
        calls.push("cleanup");
      },
    ),
    (error) => error.registrationCode === "licence_already_linked",
  );
  assert.deepEqual(calls, ["profile", "link", "cleanup"]);
});

test("accepte signUp avec session et finalise immédiatement", () => {
  assert.equal(getRegistrationOutcome(true), "completed");
});

test("accepte signUp sans session et attend la confirmation email", () => {
  assert.equal(getRegistrationOutcome(false), "confirmation_required");
});

test("bloque temporairement les vérifications abusives", () => {
  let now = 1_000;
  const limiter = new VerificationAttemptLimiter(() => now);
  for (let attempt = 0; attempt < 5; attempt += 1) limiter.recordResult(false);
  assert.equal(limiter.canAttempt(), false);
  now += 5_000;
  assert.equal(limiter.canAttempt(), true);
  limiter.recordResult(true);
  assert.equal(limiter.canAttempt(), true);
});

test("signale l'échec du nettoyage compensatoire", async () => {
  await assert.rejects(
    completeMemberRegistrationWithCleanup(
      async () => {},
      async () => {
        throw new Error("link failed");
      },
      async () => {
        throw new Error("cleanup failed");
      },
    ),
    (error) => error.registrationCode === "cleanup_failed",
  );
});

test("le nettoyage Auth supprime le profil et sa liaison par cascade", () => {
  assert.match(
    profileMigration,
    /references auth\.users \(id\) on delete cascade/i,
  );
  assert.match(cleanupFunction, /auth\.admin\.deleteUser\(\s*data\.user\.id/);
});

const pendingMetadata = {
  registration_pending: true,
  registration_token: "registration-123",
  pending_member_identity: {
    licenceNumber: "LIC-1",
    lastName: "Dupont",
    firstName: "Marie",
    birthDate: "1990-01-01",
  },
};

test("autorise le cleanup uniquement pendant l'inscription", () => {
  assert.equal(
    canCleanupMemberRegistration(pendingMetadata, "registration-123", null),
    true,
  );
});

test("refuse le cleanup sans token valide", () => {
  assert.equal(
    canCleanupMemberRegistration(pendingMetadata, "incorrect", null),
    false,
  );
});

test("refuse le cleanup sans registration_pending", () => {
  assert.equal(
    canCleanupMemberRegistration(
      { ...pendingMetadata, registration_pending: null },
      "registration-123",
      null,
    ),
    false,
  );
});

test("refuse toujours de supprimer un compte déjà finalisé", () => {
  assert.equal(
    canCleanupMemberRegistration(
      pendingMetadata,
      "registration-123",
      "member-id",
    ),
    false,
  );
  assert.equal(
    canCleanupMemberRegistration({}, "registration-123", null),
    false,
  );
});
