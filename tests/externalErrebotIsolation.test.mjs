import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20261014120000_external_errebot_isolated_import.sql",
    import.meta.url,
  ),
  "utf8",
);
const reminders = await readFile(
  new URL(
    "../supabase/migrations/20261014123000_external_errebot_match_notifications.sql",
    import.meta.url,
  ),
  "utf8",
);
const form = await readFile(
  new URL(
    "../src/features/admin/tournaments/components/ErrebotTournamentImportFinalize.tsx",
    import.meta.url,
  ),
  "utf8",
);
const player = await readFile(
  new URL(
    "../src/features/user-space/tournaments/pages/MyTournamentsPage.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("external Errebot uses dedicated storage instead of court reservations", () => {
  assert.match(migration, /external_errebot_tournaments/);
  assert.match(migration, /admin_import_external_errebot/);
  assert.doesNotMatch(migration, /insert into public\.reservations/);
  assert.doesNotMatch(
    migration,
    /insert into public\.tournament_match_planning/,
  );
  assert.doesNotMatch(migration, /insert into public\.tournament_resources/);
  assert.match(form, /externalTournament/);
  assert.match(form, /admin_import_external_errebot/);
  assert.match(form, /!externalVenue\.trim/);
});
test("verified participant sees external fixtures without local booking controls", () => {
  assert.match(migration, /list_my_external_errebot_tournaments/);
  assert.match(migration, /ident\.status='verified'/);
  assert.match(player, /Mes tournois extérieurs/);
  assert.match(player, /list_my_external_errebot_tournaments/);
});
test("notifications are tied to the participating team and published after deliveries", () => {
  assert.match(reminders, /ep\.external_team_id in/);
  assert.match(reminders, /external_errebot_reminder_events/);
  assert.ok(
    reminders.indexOf("insert into public.communication_deliveries") <
      reminders.indexOf(
        "update public.club_communications set status='published'",
      ),
  );
});
