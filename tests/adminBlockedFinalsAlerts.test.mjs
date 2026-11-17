import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const load = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const sql = load(
  "../supabase/migrations/20261117193000_admin_blocked_finals_alerts.sql",
);
const shell = load("../src/features/admin/components/AdminShell.tsx");
const alerts = load(
  "../src/features/admin/components/AdminBlockedFinalsAlerts.tsx",
);

test("all known but unpublished finals are visible to authorized club tournament administrators", () => {
  assert.match(sql, /admin_list_blocked_tournament_finals/);
  assert.match(sql, /public\.admin_current_club_id\(\)/);
  assert.match(
    sql,
    /public\.has_club_permission\(target_club,'tournaments\.manage'\)/,
  );
  assert.match(sql, /t\.club_id=target_club/);
  assert.match(sql, /m\.team_a_id is not null and m\.team_b_id is not null/);
  assert.match(sql, /not exists \([\s\S]*?public\.tournament_match_events me/);
});

test("reasons distinguish no slot, expired slot, incompatible availability, and conflicts", () => {
  for (const reason of [
    "no_slot",
    "past_slot",
    "incompatible_availability",
    "occupied",
    "publication_pending",
    "engine_error",
  ]) {
    assert.ok(sql.includes(reason), reason);
    assert.ok(alerts.includes(reason), reason);
  }
});

test("automatic-progress failure remains observable even though validated result is preserved", () => {
  assert.match(sql, /tournament_final_auto_progress_errors/);
  assert.match(sql, /on conflict \(tournament_id,match_id\)/);
  assert.match(sql, /exception when others then/);
  assert.match(sql, /raise warning/);
  assert.match(
    sql,
    /revoke all on public\.tournament_final_auto_progress_errors from public,anon,authenticated/,
  );
});

test("admin banner requires tournament permission and polls for new issues", () => {
  assert.match(
    shell,
    /hasPermission\(ADMIN_PERMISSIONS\.tournaments\) && <AdminBlockedFinalsAlerts/,
  );
  assert.match(alerts, /admin_list_blocked_tournament_finals/);
  assert.match(alerts, /setInterval\(\(\) => void poll\(\), 60000\)/);
  assert.match(alerts, /aria-label="Alertes phases finales"/);
  assert.match(alerts, /Ouvrir la planification des phases finales/);
});
