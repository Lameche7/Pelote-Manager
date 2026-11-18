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
  assert.match(admin, /publishReadyManualFinal/);
  assert.doesNotMatch(admin, /publishSeries|advanceSeries|\.publish\(/);
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
  assert.match(admin, /publishReadyManualFinal/);
});

test("manual final publication uses the existing protected automatic engine", () => {
  const service = file(
    "../src/features/admin/tournaments/services/tournamentFinalStageAdminService.ts",
  );
  const quick = file(
    "../src/features/admin/tournaments/components/AdminTournamentFinalFullPlanning.tsx",
  );
  const migration = file(
    "../supabase/migrations/20261118153000_publish_ready_manually_placed_finals.sql",
  );
  assert.match(admin, /publishReadyManualFinal/);
  assert.match(quick, /publishReadyManualFinal/);
  assert.match(service, /admin_publish_ready_manual_final/);
  assert.match(migration, /has_club_permission/);
  assert.match(migration, /team_a_id is null/);
  assert.match(migration, /team_b_id is null/);
  assert.match(migration, /tournament_team_availability_slots/);
  assert.match(
    migration,
    /auto_progress_independent_tournament_final_branches/,
  );
  assert.match(
    migration,
    /revoke all on function public.admin_publish_ready_manual_final/,
  );
  assert.match(admin, /Créneau enregistré, mais non publié/);
});
