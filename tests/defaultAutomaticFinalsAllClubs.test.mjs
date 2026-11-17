import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261117181000_default_automatic_finals_for_all_clubs.sql",
    import.meta.url,
  ),
  "utf8",
);
const engine = readFileSync(
  new URL(
    "../supabase/migrations/20261117170000_auto_advance_independent_final_branches.sql",
    import.meta.url,
  ),
  "utf8",
);

test("new tournaments across every club get automatic finals by default", () => {
  assert.match(
    migration,
    /alter table public\.tournaments\s+alter column finals_auto_advance_enabled set default true/,
  );
  assert.doesNotMatch(migration, /club_id\s*=/);
  assert.doesNotMatch(migration, /where id\s*=/);
});

test("active existing tournaments are enabled without reprogramming fixtures", () => {
  assert.match(migration, /update public\.tournaments/);
  assert.match(migration, /where finals_auto_advance_enabled = false/);
  assert.match(migration, /status not in \('completed', 'archived', 'cancelled'\)/);
  assert.doesNotMatch(
    migration,
    /(?:insert into|delete from|update) public\.(?:tournament_matches|tournament_final_planning_nodes|tournament_match_results|tournament_match_events)/i,
  );
});

test("the existing guarded result trigger remains shared by all clubs", () => {
  assert.match(
    engine,
    /after insert or update of status on public\.tournament_match_results/,
  );
  assert.match(engine, /if new\.status<>'validated' then return new/);
  assert.match(engine, /and t\.finals_auto_advance_enabled/);
  assert.match(engine, /not exists\(select 1 from public\.tournament_match_events me/);
});
