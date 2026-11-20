import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261120232000_final_auto_progress_error_admin_push.sql",
    import.meta.url,
  ),
  "utf8",
);

test("an engine error creates a club-scoped in-app and push-ready admin message", () => {
  for (const fragment of [
    "notify_tournament_final_engine_error",
    "from public.tournament_final_auto_progress_errors error",
    "permission.permission_key='tournaments.manage'",
    "membership.club_id=target.club_id",
    "insert into public.communication_deliveries",
    "update public.club_communications",
    "set status='published'",
  ]) {
    assert.ok(migration.includes(fragment), fragment);
  }
});

test("an identical incident does not resend alerts but a new incident can", () => {
  assert.match(migration, /primary key \(tournament_id, match_id\)/);
  assert.match(migration, /on conflict \(tournament_id,match_id\) do update/);
  assert.match(migration, /first_seen_at\s+is distinct from excluded\.first_seen_at/);
});

test("score validation survives failures of the auto-progress AND notification", () => {
  assert.match(migration, /exception when others then[\s\S]*?insert into public\.tournament_final_auto_progress_errors/);
  assert.match(migration, /begin\s+perform public\.notify_tournament_final_engine_error/);
  assert.match(migration, /exception when others then\s+raise warning/);
  assert.match(migration, /return new;/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on function public\.notify_tournament_final_engine_error/);
});
