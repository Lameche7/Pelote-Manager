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

test("an engine error sends a scoped admin notification", () => {
  const required = [
    "notify_tournament_final_engine_error",
    "from public.tournament_final_auto_progress_errors error",
    "permission.permission_key='tournaments.manage'",
    "membership.club_id=target.club_id",
    "insert into public.communication_deliveries",
    "update public.club_communications",
    "set status='published'",
  ];
  for (const fragment of required) {
    assert.ok(migration.includes(fragment), fragment);
  }
});

test("one alert is sent per incident, not per retry", () => {
  const required = [
    "primary key (tournament_id, match_id)",
    "on conflict (tournament_id,match_id) do update",
    "is distinct from excluded.first_seen_at",
  ];
  for (const fragment of required) {
    assert.ok(migration.includes(fragment), fragment);
  }
});

test("a notification error cannot undo a validated score", () => {
  const required = [
    "exception when others then",
    "insert into public.tournament_final_auto_progress_errors",
    "begin\n      perform public.notify_tournament_final_engine_error",
    "return new;",
    "enable row level security",
    "revoke all on function public.notify_tournament_final_engine_error",
  ];
  for (const fragment of required) {
    assert.ok(migration.includes(fragment), fragment);
  }
});
