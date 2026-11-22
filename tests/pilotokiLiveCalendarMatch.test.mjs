import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { resolveVerifiedCalendarMatch } from "../api/_live-calendar-match.mjs";

const clubId = "188029a8-3e6a-41cd-821f-01984a703552";
const resourceId = "33333333-3333-4333-8333-333333333333";
const matchId = "22222222-2222-4222-8222-222222222222";
const slot = {
  resourceId,
  startsAt: "2026-12-12T14:00:00+01:00",
  endsAt: "2026-12-12T15:00:00+01:00",
};
const env = {
  VITE_SUPABASE_URL: "https://example.supabase.co",
  VITE_SUPABASE_ANON_KEY: "public-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};
const request = {
  headers: { authorization: "Bearer authenticated-user" },
};

function mockFetch({ resourceClubValid = true, match = null } = {}) {
  const calls = [];
  const mock = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/reservable_resources?"))
      return {
        ok: true,
        json: async () =>
          resourceClubValid ? [{ id: resourceId }] : [],
      };
    if (url.endsWith("/rpc/resolve_calendar_competition"))
      return {
        ok: true,
        json: async () =>
          match ?? { kind: "tournament", matchId },
      };
    throw new Error("Unexpected request");
  };
  return { mock, calls };
}

test("Verifies an actual match and club before linking a video", async () => {
  const { mock, calls } = mockFetch();
  assert.deepEqual(
    await resolveVerifiedCalendarMatch(env, request, clubId, slot, mock),
    { sourceId: matchId, sourceType: "tournoi" },
  );
  assert.ok(calls[0].url.includes("club_id=eq."));
  assert.equal(
    calls[1].options.headers.authorization,
    "Bearer authenticated-user",
  );
  assert.ok(!calls[1].options.body.includes("clubId"));
});

test("Another club's resource cannot start a broadcast", async () => {
  const { mock, calls } = mockFetch({ resourceClubValid: false });
  await assert.rejects(
    resolveVerifiedCalendarMatch(env, request, clubId, slot, mock),
    /n'appartient pas/,
  );
  assert.equal(calls.length, 1);
});

test("An unprogrammed match is rejected", async () => {
  const { mock } = mockFetch({ match: {} });
  await assert.rejects(
    resolveVerifiedCalendarMatch(env, request, clubId, slot, mock),
    /n'est plus programmée/,
  );
});

test("User cannot spoof a match ID directly from the browser", () => {
  const prepare = readFileSync(
    new URL("../api/live-youtube-prepare.mjs", import.meta.url),
    "utf8",
  );
  assert.match(prepare, /resolveVerifiedCalendarMatch/);
  assert.match(prepare, /input\.sourceId = match\.sourceId/);
  assert.match(prepare, /Une vidéo existe déjà pour cette partie/);
  const calendar = readFileSync(
    new URL(
      "../src/features/reservations/pages/ReservationsPage.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(calendar, /params\.set\("liveResource"/);
  assert.match(calendar, /params\.set\("liveEnd"/);
  assert.match(calendar, /Diffuser cette partie/);
});
