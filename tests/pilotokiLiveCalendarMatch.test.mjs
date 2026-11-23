import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  resolveVerifiedCalendarMatch,
  resolveVerifiedLiveSlot,
  ordinaryCalendarLiveSourceId,
} from "../api/_live-calendar-match.mjs";

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
        json: async () => (resourceClubValid ? [{ id: resourceId }] : []),
      };
    if (url.endsWith("/rpc/resolve_calendar_competition"))
      return {
        ok: true,
        json: async () => match ?? { kind: "tournament", matchId },
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
  assert.match(prepare, /resolveVerifiedLiveSlot/);
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

test("Calendar broadcaster opens a standalone non-admin launch with scoped match verification", () => {
  const calendar = readFileSync(
    new URL(
      "../src/features/reservations/pages/ReservationsPage.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const router = readFileSync(
    new URL("../src/app/router.tsx", import.meta.url),
    "utf8",
  );
  const launch = readFileSync(
    new URL(
      "../src/features/admin/live/pages/PilotokiLiveMatchLaunchPage.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const permissions = readFileSync(
    new URL(
      "../src/features/admin/config/adminPermissions.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(calendar, /navigate\(\`\/live\/launch\?\$\{params\}\`\)/);
  assert.doesNotMatch(
    calendar,
    /navigate\(\`\$\{ROUTES\.admin\}\/parametres\/live/,
  );
  assert.match(router, /path: "\/live\/launch"/);
  assert.match(router, /<PilotokiLiveMatchLaunchPage/);
  assert.match(launch, /action: "resolve_slot"/);
  assert.match(launch, /video\.sourceId === resolvedMatchId/);
  assert.match(launch, /settings\.clubId !== clubId/);
  assert.match(launch, /consentConfirmed: true/);
  assert.match(
    launch,
    /const \[madeForKids, setMadeForKids\] = useState\(false\)/,
  );
  assert.match(launch, /madeForKids,/);
  assert.match(launch, /\/live\/camera\?videoId=/);
  assert.match(
    permissions,
    /label: "Pilotoki Live"[\s\S]*permission: ADMIN_PERMISSIONS\.settings/,
  );
});

test("Ordinary reservations and available slots have a stable authorized video identity", async () => {
  for (const status of ["occupied", "available"]) {
    const calls = [];
    const verified = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("/reservable_resources?"))
        return { ok: true, json: async () => [{ id: resourceId }] };
      if (String(url).endsWith("/rpc/list_available_slots_v4"))
        return {
          ok: true,
          json: async () => [
            {
              resource_id: resourceId,
              starts_at: slot.startsAt,
              ends_at: slot.endsAt,
              status,
              occupation_type: status === "occupied" ? "reservation" : null,
            },
          ],
        };
      throw new Error("Unexpected request");
    };
    const result = await resolveVerifiedLiveSlot(
      env,
      request,
      clubId,
      slot,
      "other",
      verified,
    );
    assert.equal(result.sourceType, "other");
    assert.equal(
      result.sourceId,
      ordinaryCalendarLiveSourceId(
        clubId,
        resourceId,
        slot.startsAt,
        slot.endsAt,
      ),
    );
    assert.match(result.sourceId, /^[0-9a-f-]{36}$/);
    assert.equal(
      calls[1].options.headers.authorization,
      "Bearer authenticated-user",
    );
  }
});

test("A different club, closed slot or fake time cannot be streamed", async () => {
  const badResource = async (url) => {
    if (String(url).includes("/reservable_resources?"))
      return { ok: true, json: async () => [] };
    throw new Error("Unexpected request");
  };
  await assert.rejects(
    resolveVerifiedLiveSlot(env, request, clubId, slot, "other", badResource),
    /n'appartient pas/,
  );
  const closed = async (url) => {
    if (String(url).includes("/reservable_resources?"))
      return { ok: true, json: async () => [{ id: resourceId }] };
    return {
      ok: true,
      json: async () => [
        {
          resource_id: resourceId,
          starts_at: slot.startsAt,
          ends_at: slot.endsAt,
          status: "locked",
          occupation_type: null,
        },
      ],
    };
  };
  await assert.rejects(
    resolveVerifiedLiveSlot(env, request, clubId, slot, "other", closed),
    /n'est plus disponible/,
  );
  await assert.rejects(
    resolveVerifiedLiveSlot(
      env,
      request,
      clubId,
      { ...slot, startsAt: "2026-12-12T14:30:00+01:00" },
      "other",
      closed,
    ),
    /n'est plus disponible/,
  );
  assert.notEqual(
    ordinaryCalendarLiveSourceId(
      clubId,
      resourceId,
      slot.startsAt,
      slot.endsAt,
    ),
    ordinaryCalendarLiveSourceId(
      clubId,
      resourceId,
      "2026-12-12T14:30:00+01:00",
      slot.endsAt,
    ),
  );
});
