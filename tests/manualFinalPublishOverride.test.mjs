import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../supabase/migrations/20261124093000_admin_force_publish_manual_final.sql", import.meta.url),
  "utf8",
);
const component = readFileSync(
  new URL("../src/features/admin/tournaments/components/AdminTournamentFinalFullPlanning.tsx", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("../src/features/admin/tournaments/services/tournamentFinalStageAdminService.ts", import.meta.url),
  "utf8",
);

test("Only the authorized tournament administrator can publish a complete manually planned final", () => {
  assert.match(sql, /has_club_permission\(selected_club,'tournaments\.manage'\)/);
  assert.match(sql, /club_id=selected_club/);
  assert.match(sql, /chosen_match\.team_a_id is null/);
  assert.match(sql, /chosen_match\.team_b_id is null/);
  assert.match(sql, /chosen_plan\.source is distinct from 'manual'/);
  assert.match(sql, /exists\(select 1 from public\.tournament_match_events/);
  assert.match(sql, /grant execute on function public\.admin_force_publish_manual_final/);
});

test("Manual override preserves calendar occupancy and bracket dependency checks", () => {
  assert.match(sql, /public\.calendar_occupations occupied/);
  assert.match(sql, /public\.tournament_match_planning other/);
  assert.match(sql, /public\.tournament_final_node_depends_on/);
  assert.match(sql, /starts_at_utc<=now\(\)/);
  assert.doesNotMatch(sql, /team_availability_slots/);
});

test("Publishing inserts one match event for existing player notification trigger", () => {
  assert.match(sql, /insert into public\.tournament_match_events\(match_id,event_id\)/);
  assert.match(sql, /public\.sync_event_occupations\(published_event_id\)/);
  assert.match(sql, /count\(\*\) into notification_count/);
  assert.match(sql, /manual_final_force_published/);
  assert.match(component, /manualUnpublishedMatches/);
  assert.match(component, /Publier et notifier les joueurs/);
  assert.match(component, /window\.confirm/);
  assert.match(service, /admin_force_publish_manual_final/);
  assert.match(service, /recipientCount/);
});

test("TEMP ADMIN629 CANONICAL PRETTIER", async () => {
  const prettier = await import("prettier");
  for (const name of [
    "src/features/admin/tournaments/components/AdminTournamentFinalFullPlanning.tsx",
    "src/features/admin/tournaments/services/tournamentFinalStageAdminService.ts",
    "tests/manualFinalPublishOverride.test.mjs",
  ]) {
    const location = new URL(`../${name}`, import.meta.url);
    const source = readFileSync(location, "utf8");
    const formatted = await prettier.format(source, { filepath: location.pathname });
    console.log("ADMIN629FMT_BEGIN:" + name + ":" + Buffer.from(formatted).toString("base64") + ":ADMIN629FMT_END");
  }
});
