import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL("../" + path, import.meta.url), "utf8");
const page = read("src/features/reservations/pages/ClubPlanningPage.tsx");
const actions = read(
  "src/features/reservations/components/PlanningMatchActions.tsx",
);
const calendar = read(
  "src/features/reservations/services/reservationCalendarService.ts",
);
const sql = read("tests/sql/public-tournament-planning-slots.draft.sql");
const access = read("tests/sql/scoped-planning-access.draft.sql");

test("planning combines installations but retains resource identity", () => {
  assert.match(page, /listResources\(clubSlug\)/);
  assert.match(page, /selection === ALL \|\| resource.id === selection/);
  assert.match(page, /slot.resourceId === resource.id/);
  assert.match(page, /resourceLabels=\{labels\}/);
  assert.match(page, /readOnly/);
  assert.match(page, /onInspect=\{setInspected\}/);
});

test("planning uses published-only RPC without replacing reservations RPC", () => {
  assert.match(page, /listSlots\(\s*resource.id,\s*from,\s*to,\s*true,/);
  assert.match(calendar, /tournamentPlanningOnly = false/);
  assert.match(calendar, /"list_public_tournament_planning_slots"/);
  assert.match(calendar, /"list_available_slots_v4"/);
  assert.match(sql, /e.publication_status='published'/);
  assert.match(sql, /e.archived_at is null/);
  assert.match(sql, /r.club_id=t.club_id/);
  assert.match(sql, /e.club_id=t.club_id/);
});

test("administrative panels require current server permission and club scope", () => {
  assert.match(actions, /can_manage_tournament_planning_for_club/);
  assert.match(actions, /adminClub === clubId && competition/);
  assert.match(actions, /scopedClubId=\{clubId\}/);
  assert.match(actions, /scopedMatchId=\{competition.matchId\}/);
  assert.match(actions, /platformAdminLeaseService.issue\(clubId\)/);
  assert.match(
    actions,
    /window.setInterval\(\(\) => void checkPermission\(\), 5000\)/,
  );
  assert.match(
    actions,
    /const clearPermission = \(\) => \{[\s\S]*?setContacts\(null\)/,
  );
  assert.match(
    access,
    /has_active_platform_lease\(auth.uid\(\),target_club_id\)/,
  );
  assert.match(access, /from public, anon, authenticated/);
});

test("player actions only use resolved identity and matching tournament", () => {
  assert.match(actions, /actions.matchId === match.matchId/);
  assert.match(actions, /identity\?\.actions.submitResult/);
  assert.match(actions, /identity\?\.actions.volunteerReferee/);
  assert.match(actions, /identity\?\.actions.requestReportInMySpace/);
});
