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

test("projected final bracket slots retain series color and exact node identity", () => {
  assert.match(calendar, /displayColor: projectedSeries\?\.color \?\? null/);
  assert.match(calendar, /finalProjection: \{/);
  assert.match(calendar, /tournamentId: projection\.tournament_id/);
  assert.match(calendar, /seriesId: projection\.series_id/);
  assert.match(calendar, /roundNumber: projection\.round_number/);
  assert.match(calendar, /displayOrder: projection\.display_order/);
  assert.match(types, /finalProjection\?: \{/);
  assert.match(
    card,
    /isTournamentMatch \|\| isChampionshipMatch \|\| isProjection/,
  );
  assert.match(card, /"Phase finale · prévisionnel"/);
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
  assert.match(admin, /tournamentFinalStageAdminService\.getFullPlanning/);
  assert.match(
    admin,
    /tournamentFinalStageAdminService\.setExceptionalManualSlot/,
  );
  assert.match(admin, /tournamentFinalStageAdminService\.saveFullPlanning/);
  assert.match(admin, /slotId: null/);
  assert.match(admin, /!node\.published/);
  assert.match(admin, /node\.resultStatus !== "validated"/);
  assert.match(admin, /Cette action ne publie pas de/);
  assert.doesNotMatch(admin, /publishSeries|advanceSeries|publish\(/);
});
