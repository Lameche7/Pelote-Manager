import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const calendar = readFileSync(
  new URL(
    "../src/features/reservations/pages/ReservationsPage.tsx",
    import.meta.url,
  ),
  "utf8",
);
const liveAdmin = readFileSync(
  new URL(
    "../src/features/admin/live/pages/AdminLiveSettingsPage.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("Calendar proposes live on free or occupied real slots to authorized administrators", () => {
  assert.match(
    calendar,
    /canPrepareLive = adminPermissions\.includes\(ADMIN_PERMISSIONS\.settings\)/,
  );
  assert.match(
    calendar,
    /isAuthenticated && canPrepareLive && \["occupied", "available"\]\.includes\(inspectedSlot\.status\)/,
  );
  assert.match(calendar, /params\.set\("liveResource", inspectedSlot\.resourceId\)/);
  assert.match(calendar, /Diffuser cette partie/);
  assert.doesNotMatch(calendar, /setLiveComingSoon/);
});

test("Calendar forwards club, title, schedule and competition type only", () => {
  assert.match(calendar, /liveClub: selectedResource\.clubId/);
  assert.match(calendar, /liveTitle: inspectedSlot\.bookedByName/);
  assert.match(calendar, /liveStart: inspectedSlot\.startsAt/);
  assert.match(calendar, /liveType: inspectedSlot\.occupationType/);
  assert.ok(calendar.includes("navigate(`/live/launch?"));
});

test("Admin validates the incoming club and never skips YouTube consent", () => {
  assert.match(
    liveAdmin,
    /searchParams\.get\("liveClub"\) !== settings\.clubId/,
  );
  assert.match(liveAdmin, /setBroadcastTitle\(/);
  assert.match(liveAdmin, /setBroadcastStart\(/);
  assert.match(liveAdmin, /setBroadcastType\(kind\)/);
  assert.match(liveAdmin, /if \(!consentConfirmed\)/);
  assert.match(liveAdmin, /sourceId: null/);
});
