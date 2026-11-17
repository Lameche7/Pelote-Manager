import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const scheduling = read(
  "../supabase/migrations/20261117201500_schedule_confirmed_final_teams.sql",
);
const notifications = read(
  "../supabase/migrations/20261117202000_final_admin_automatic_outcome_notifications.sql",
);
const progression = read(
  "../supabase/migrations/20261117202500_progress_finals_after_opponents_known.sql",
);
const calendar = read(
  "../src/features/reservations/services/reservationCalendarService.ts",
);

test("unresolved knockout places are neither visible in player calendars nor held by generated preferences", () => {
  assert.doesNotMatch(
    calendar,
    /list_public_tournament_final_calendar_projections_v2/,
  );
  assert.doesNotMatch(calendar, /tournament_finals_projection/);
  assert.match(scheduling, /n\.source='generated' and n\.round_number>0/);
  assert.match(scheduling, /and not exists \(/);
  assert.match(scheduling, /m\.phase='finals'/);
});

test("qualified teams are scheduled only on jointly declared available slots and without court collisions", () => {
  assert.match(
    scheduling,
    /public\.tournament_generated_slots\(target_tournament_id\)/,
  );
  assert.match(scheduling, /a\.team_id=entry\.team_a_id/);
  assert.match(scheduling, /b\.team_id=entry\.team_b_id/);
  assert.match(scheduling, /public\.calendar_occupations occ/);
  assert.match(scheduling, /public\.tournament_match_planning other/);
  assert.match(scheduling, /public\.tournament_final_node_depends_on/);
  assert.match(scheduling, /previous_plan\.play_date/);
  assert.match(scheduling, /existing_plan\.source='manual'/);
  assert.match(
    scheduling,
    /slot\.play_date between earliest_date and latest_date/,
  );
});

test("validated-result progression creates matches before assigning and publishing them", () => {
  assert.match(progression, /public\.auto_assign_ready_tournament_final_slots/);
  assert.match(progression, /insert into public\.events/);
  assert.match(progression, /insert into public\.tournament_match_events/);
  assert.doesNotMatch(
    progression,
    /not exists \(\s*select 1 from public\.tournament_final_planning_nodes another/,
  );
});

test("a deduplicated push/in-app alert is sent to authorized administrators for success or blockage", () => {
  assert.match(
    notifications,
    /outcome text not null check\(outcome in \('scheduled','blocked'\)\)/,
  );
  assert.match(notifications, /primary key\(match_id,outcome\)/);
  assert.match(
    notifications,
    /permission\.permission_key='tournaments\.manage'/,
  );
  assert.match(notifications, /membership\.club_id=target\.club_id/);
  assert.match(notifications, /insert into public\.communication_deliveries/);
  assert.match(notifications, /set status='published'/);
  assert.match(progression, /notify_tournament_final_admin_auto_outcome/);
  assert.match(progression, /notice\.outcome='blocked'/);
});
