import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { encryptIngestCredentials } from "../api/_live-youtube-ingest.mjs";
import {
  decryptIngest,
  createStopTicket,
  verifyStopTicket,
} from "../api/live-bridge-session.mjs";

const env = {
  YOUTUBE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  [["LIVE", "BRIDGE", "SHARED", "SECRET"].join("_")]:
    randomBytes(32).toString("hex"),
};
const club = "6efbfcc0-768d-421f-9cba-04851dece98d";
test("Live bridge never exposes YouTube stream key through a browser ticket", () => {
  const encrypted = encryptIngestCredentials(env, {
    address: "rtmps://a.rtmp.youtube.com/live2",
    streamName: "abcd-efgh-ijkl",
  });
  assert.equal(
    decryptIngest(env, {
      ingest_ciphertext: encrypted.ciphertext,
      ingest_iv: encrypted.iv,
    }),
    "rtmps://a.rtmp.youtube.com/live2/abcd-efgh-ijkl",
  );
  const ticket = createStopTicket(env, {
    clubId: club,
    sessionId: "a".repeat(32),
    expires: Date.now() + 100_000,
  });
  assert.doesNotMatch(ticket, /abcd-efgh-ijkl|youtube/i);
  assert.equal(verifyStopTicket(env, ticket, club).sessionId, "a".repeat(32));
  assert.throws(() => verifyStopTicket(env, ticket, "other-club"));
  assert.throws(() =>
    verifyStopTicket(
      env,
      ticket.slice(0, -1) + (ticket.endsWith("0") ? "1" : "0"),
      club,
    ),
  );
  assert.throws(() =>
    verifyStopTicket(
      env,
      createStopTicket(env, {
        clubId: club,
        sessionId: "a".repeat(32),
        expires: Date.now() - 1000,
      }),
      club,
    ),
  );
});
test("Live bridge rejects arbitrary RTMPS hosts and bad encrypted secrets", () => {
  const encrypted = encryptIngestCredentials(env, {
    address: "rtmps://example.com/live",
    streamName: "foo",
  });
  assert.throws(() =>
    decryptIngest(env, {
      ingest_ciphertext: encrypted.ciphertext,
      ingest_iv: encrypted.iv,
    }),
  );
  const good = encryptIngestCredentials(env, {
    address: "rtmps://a.rtmp.youtube.com/live2",
    streamName: "abc-def",
  });
  assert.throws(() =>
    decryptIngest(env, {
      ingest_ciphertext: good.ciphertext.slice(1) + "!",
      ingest_iv: good.iv,
    }),
  );
});
