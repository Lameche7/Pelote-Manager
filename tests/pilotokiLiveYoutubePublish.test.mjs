import assert from "node:assert/strict";
import { test } from "node:test";
import { publishVerifiedYoutubeLive } from "../api/_live-youtube-publish.mjs";

const id = "AbCdEfGh123";
const streamId = "YTstream123";
function mock({
  streamStatus = "active",
  boundStreamId = streamId,
  lifecycle = "ready",
} = {}) {
  const requests = [];
  const fetchMock = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.includes("/liveBroadcasts?"))
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              id,
              contentDetails: { boundStreamId },
              status: {
                lifeCycleStatus: lifecycle,
                privacyStatus: "unlisted",
              },
            },
          ],
        }),
      };
    if (url.includes("/liveStreams?"))
      return {
        ok: true,
        json: async () => ({
          items: [{ id: streamId, status: { streamStatus } }],
        }),
      };
    if (url.includes("/liveBroadcasts/transition?"))
      return {
        ok: true,
        json: async () => ({
          id,
          status: { lifeCycleStatus: "liveStarting" },
        }),
      };
    throw new Error("Unexpected API");
  };
  return { requests, fetchMock };
}

test("Publishes only a broadcast bound to an active YouTube stream", async () => {
  const { requests, fetchMock } = mock();
  const result = await publishVerifiedYoutubeLive(
    "private-access-token",
    id,
    streamId,
    fetchMock,
  );
  assert.deepEqual(result, { status: "liveStarting", alreadyLive: false });
  const writes = requests.filter(
    (request) => request.options.method === "POST",
  );
  assert.equal(writes.length, 1);
  assert.match(writes[0].url, /broadcastStatus=live/);
  assert.doesNotMatch(JSON.stringify(result), /private-access-token/);
});

test("Blocks publication if YouTube has not received the camera", async () => {
  const { requests, fetchMock } = mock({ streamStatus: "inactive" });
  await assert.rejects(
    publishVerifiedYoutubeLive("token", id, streamId, fetchMock),
    /n'a pas encore reçu le signal/,
  );
  assert.equal(
    requests.some((r) => r.options.method === "POST"),
    false,
  );
});

test("Blocks publication if YouTube broadcast is bound to another stream", async () => {
  const { requests, fetchMock } = mock({
    boundStreamId: "DifferentStream",
  });
  await assert.rejects(
    publishVerifiedYoutubeLive("token", id, streamId, fetchMock),
    /n'est pas lié/,
  );
  assert.equal(
    requests.some((r) => r.options.method === "POST"),
    false,
  );
});

test("Already live is idempotent, with no new transition", async () => {
  const { requests, fetchMock } = mock({ lifecycle: "live" });
  assert.deepEqual(
    await publishVerifiedYoutubeLive("token", id, streamId, fetchMock),
    { status: "live", alreadyLive: true },
  );
  assert.equal(
    requests.some((r) => r.options.method === "POST"),
    false,
  );
});

test("Accepts an automatically starting broadcast without a transition request", async () => {
  const { requests, fetchMock } = mock({ lifecycle: "liveStarting" });
  assert.deepEqual(
    await publishVerifiedYoutubeLive("token", id, streamId, fetchMock),
    { status: "liveStarting", alreadyLive: true },
  );
  assert.equal(
    requests.some((request) => request.options.method === "POST"),
    false,
  );
});

test("Accepts YouTube auto-start racing with the transition", async () => {
  let readCount = 0;
  const requests = [];
  const fetchMock = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.includes("/liveBroadcasts?")) {
      readCount += 1;
      return {
        ok: true,
        json: async () => ({
          items: [{
            id,
            contentDetails: { boundStreamId: streamId },
            status: {
              privacyStatus: "unlisted",
              lifeCycleStatus: readCount === 1 ? "ready" : "live",
            },
          }],
        }),
      };
    }
    if (url.includes("/liveStreams?"))
      return {
        ok: true,
        json: async () => ({
          items: [{ id: streamId, status: { streamStatus: "active" } }],
        }),
      };
    if (url.includes("/liveBroadcasts/transition?"))
      return { ok: false, status: 403 };
    throw new Error("Unexpected YouTube request");
  };
  assert.deepEqual(
    await publishVerifiedYoutubeLive("token", id, streamId, fetchMock),
    { status: "live", alreadyLive: true },
  );
  assert.equal(readCount, 2);
  assert.equal(requests.filter((request) => request.options.method === "POST").length, 1);
});
