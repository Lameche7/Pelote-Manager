import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const calendar = readFileSync(
  new URL("../src/features/reservations/pages/ReservationsPage.tsx", import.meta.url),
  "utf8",
);
const liveAdmin = readFileSync(
  new URL("../src/features/admin/live/pages/AdminLiveSettingsPage.tsx", import.meta.url),
  "utf8",
);

test("Calendar proposes Pilotoki Live only for booked matches to a settings administrator", () => {
  assert.match(calendar, /canPrepareLive = adminPermissions\.includes\(ADMIN_PERMISSIONS\.settings\)/);
  assert.match(calendar, /isAuthenticated && canPrepareLive && inspectedSlot\.status === "occupied"/);
  assert.match(calendar, /Boolean\(inspectedSlot\.ordinaryTeams\)/);
  assert.match(calendar, /Préparer le direct de cette partie/);
  assert.doesNotMatch(calendar, /setLiveComingSoon/);
});

test("Calendar forwards club, title, schedule and competition type only", () => {
  assert.match(calendar, /liveClub: selectedResource\.clubId/);
  assert.match(calendar, /liveTitle: inspectedSlot\.bookedByName/);
  assert.match(calendar, /liveStart: inspectedSlot\.startsAt/);
  assert.match(calendar, /liveType: inspectedSlot\.occupationType/);
  assert.match(calendar, /navigate\(`$\{ROUTES\.admin\}\/parametres\/live\?/);
});

test("Admin validates the incoming club and never skips YouTube consent", () => {
  assert.match(liveAdmin, /searchParams\.get\("liveClub"\) !== settings\.clubId/);
  assert.match(liveAdmin, /setBroadcastTitle\(/);
  assert.match(liveAdmin, /setBroadcastStart\(/);
  assert.match(liveAdmin, /setBroadcastType\(kind\)/);
  assert.match(liveAdmin, /if \(!consentConfirmed\)/);
  assert.match(liveAdmin, /sourceId: null/);
});

test("temporary exact Prettier formatting output", async () => {
  const prettier = await import("prettier");
  for (const path of [
    "src/features/admin/live/pages/AdminLiveSettingsPage.tsx",
    "tests/calendarLiveComingSoon.test.mjs",
  ]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    const formatted = await prettier.format(source, { filepath: path });
    console.log(
      path.endsWith("tsx") ? "LIVE_ADMIN_FORMAT_B64" : "LIVE_TEST_FORMAT_B64",
      Buffer.from(formatted).toString("base64"),
    );
  }
});
