import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const file = new URL(
  "../supabase/migrations/20261104094500_notify_championship_admin_reschedules.sql",
  import.meta.url,
);

test("reprogrammation admin championnat : notification aux joueurs et arbitre", async () => {
  const sql = await readFile(file, "utf8");
  assert.match(
    sql,
    /after update of starts_at,ends_at,resource_id on public\.reservations/,
  );
  assert.match(sql, /after update of scheduled_on,scheduled_time,venue/);
  assert.match(sql, /championship_team_players/);
  assert.match(sql, /championship_players/);
  assert.match(sql, /referee_slot_assignments/);
  assert.match(sql, /select distinct profile\.id/);
  assert.match(sql, /communication_deliveries/);
  assert.match(sql, /status='published',published_at=now\(\)/);
  assert.match(sql, /recipient_count=recipient_total/);
  assert.match(sql, /new\.starts_at is not distinct from old\.starts_at/);
  assert.match(
    sql,
    /r\.championship_match_id=new\.match_id and r\.status='confirmed'/,
  );
  assert.match(sql, /new\.updated_by is distinct from auth\.uid\(\)/);
  assert.doesNotMatch(sql, /insert into public\.reservations\(/);
});
