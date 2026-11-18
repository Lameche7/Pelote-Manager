import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const file = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const calendar = file(
  "../src/features/reservations/services/reservationCalendarService.ts",
);
const types = file("../src/features/reservations/domain/calendar.ts");
const page = file("../src/features/reservations/pages/ReservationsPage.tsx");
const admin = file(
  "../src/features/reservations/components/CalendarFinalsAdminPanel.tsx",
);
const card = file("../src/features/reservations/components/SlotCard.tsx");

test("the public calendar does not turn unconfirmed brackets into reservations", () => {
  assert.doesNotMatch(
    calendar,
    /list_public_tournament_final_calendar_projections_v2/,
  );
  assert.doesNotMatch(calendar, /tournament_finals_projection/);
  assert.match(types, /finalProjection\?: \{/);
  assert.match(
    card,
    /isTournamentMatch \|\| isChampionshipMatch \|\| isProjection/,
  );
});

test("the calendar makes direct final-stage scheduling an admin-only action", () => {
  assert.match(page, /canAdminTournaments &&/);
  assert.match(page, /<CalendarFinalsAdminPanel/);
  assert.match(
    page,
    /canInspectLocked=\{canAdminReservations \|\| canAdminTournaments\}/,
  );
  assert.match(page, /Programmer une phase finale/);
  assert.match(page, /setInspectedSlot\(selectedSlot\)/);
  assert.match(page, /setSelectedSlot\(null\)/);
});

test("admin mutations reuse protected existing final-stage RPCs", () => {
  assert.match(admin, /tournamentFinalStageAdminService\s*\.getFullPlanning/);
  assert.match(
    admin,
    /tournamentFinalStageAdminService\s*\.setExceptionalManualSlot/,
  );
  assert.match(admin, /tournamentFinalStageAdminService\s*\.saveFullPlanning/);
  assert.match(admin, /slotId: null/);
  assert.match(admin, /!node\.published/);
  assert.match(admin, /node\.resultStatus !== "validated"/);
  assert.match(admin, /Cette action ne publie pas de/);
  assert.doesNotMatch(admin, /publishSeries|advanceSeries|publish\(/);
});

test("calendar manual fallback lists only complete finals without an automatic placement", () => {
  assert.match(admin, /node\.teamAId && node\.teamBId/);
  assert.match(admin, /!node\.resourceId/);
  assert.match(admin, /!node\.playDate/);
  assert.match(admin, /!node\.startsAt/);
  assert.match(admin, /!node\.endsAt/);
  assert.match(
    admin,
    /unplanned\.some\(\(node\) => nodeKey\(node\) === selectedNode\)/,
  );
  assert.match(
    admin,
    /Aucune rencontre complète ne reste à programmer manuellement/,
  );
  assert.match(admin, /Boolean\(projection\)/);
});
