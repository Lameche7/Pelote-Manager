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

test("the calendar live teaser appears for competition matches and ordinary booked matches with named teams", () => {
  assert.match(
    calendar,
    /isAuthenticated && inspectedSlot.status === "occupied" && \(inspectedSlot.occupationType === "match" \|\| inspectedSlot.occupationType === "championship_match" \|\| \(inspectedSlot.occupationType === "reservation" && Boolean\(inspectedSlot.ordinaryTeams\)\)\)/,
  );
  assert.match(calendar, /Diffuser cette partie/);
  assert.match(calendar, /Boolean\(inspectedSlot.ordinaryTeams\)/);
  assert.match(calendar, /<Video aria-hidden="true" size=\{18\}/);
});

test("clicking the camera does not start a video stream", () => {
  assert.match(calendar, /onClick=\{\(\) => setLiveComingSoon\(true\)\}/);
  assert.match(
    calendar,
    /liveComingSoon && <p role="status">Bientôt disponible<\/p>/,
  );
  assert.match(
    calendar,
    /setLiveComingSoon\(false\);\s+setInspectedSlot\(slot\)/,
  );
});
