import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import {
  encryptRefreshToken,
  sealState,
  verifyState,
  LiveAuthError,
  verifiedClubSettings,
} from "../api/_live-google-shared.mjs";

const env = {
  YOUTUBE_OAUTH_STATE_SECRET: "test-only-long-random-state-secret",
  YOUTUBE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};
const claims = {
  clubId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  channelId: "UCAIME5j0y9DdiEQNyttO_jw",
  nonce: "random-test-nonce",
  exp: Date.now() + 60_000,
};

test("OAuth state is signed, expires and cannot be tampered with", () => {
  const state = sealState(env, claims);
  assert.deepEqual(verifyState(env, state), claims);
  assert.throws(() => verifyState(env, state + "changed"), LiveAuthError);
  assert.throws(
    () => verifyState(env, sealState(env, { ...claims, exp: Date.now() - 1 })),
    LiveAuthError,
  );
});

test("Google refresh tokens are encrypted without appearing in the stored record", () => {
  const token = "sensitive-refresh-token-for-unit-test";
  const encrypted = encryptRefreshToken(env, token);
  assert.ok(encrypted.iv);
  assert.ok(encrypted.ciphertext);
  assert.ok(!JSON.stringify(encrypted).includes(token));
});

test("a requester cannot connect Google without a Pilotoki session", async () => {
  const request = { headers: {} };
  await assert.rejects(
    verifiedClubSettings(request, {
      ...env,
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_ANON_KEY: "test",
    }),
    (error) => error instanceof LiveAuthError && error.status === 401,
  );
});
