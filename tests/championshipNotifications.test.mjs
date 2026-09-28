import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const reminderMigration = new URL(
  "../supabase/migrations/20260928183000_add_championship_match_reminders.sql",
  import.meta.url,
);
const resultMigration = new URL(
  "../supabase/migrations/20260928183500_use_effective_championship_schedule_for_results.sql",
  import.meta.url,
);
const pageFile = new URL(
  "../src/features/user-space/championships/pages/MyChampionshipsPage.tsx",
  import.meta.url,
);

test("les rappels championnat utilisent la programmation réelle", async () => {
  const migration = await readFile(reminderMigration, "utf8");
  assert.match(migration, /championship_match_effective_schedule/);
  assert.match(migration, /reservation\.starts_at/);
  assert.match(migration, /championship_match_manual_schedules/);
  assert.match(migration, /part_day_10h/);
  assert.match(migration, /result_entry_due/);
  assert.match(migration, /time '10:00'/);
  assert.match(migration, /Mes championnats/);
  assert.match(migration, /\/mon-espace\/championnats\?match=%s/);
  assert.match(migration, /primary key \(match_id, club_id, reminder_kind\)/);
});

test("une proposition de résultat supprime la relance après-partie", async () => {
  const migration = await readFile(reminderMigration, "utf8");
  assert.match(migration, /archive_championship_result_entry_reminders/);
  assert.match(migration, /submission\.status = 'pending'/);
  assert.match(migration, /communication\.status = 'archived'/);
});

test("le serveur ouvre la saisie selon la programmation réelle", async () => {
  const migration = await readFile(resultMigration, "utf8");
  assert.match(migration, /championship_match_effective_schedule\(target_match_id\)/);
  assert.match(migration, /effective_starts_at > now\(\)/);
  assert.doesNotMatch(
    migration,
    /coalesce\(match_row\.agreement_on, match_row\.report_on, match_row\.scheduled_on\)\s*>/,
  );
});

test("le deep-link de notification cible la partie dans Mes championnats", async () => {
  const page = await readFile(pageFile, "utf8");
  assert.match(page, /useSearchParams/);
  assert.match(page, /searchParams\.get\("match"\)/);
  assert.match(page, /championship-match-\$\{match\.id\}/);
  assert.match(page, /scrollIntoView/);
});
