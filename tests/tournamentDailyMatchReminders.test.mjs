import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260816131500_add_tournament_daily_match_reminders.sql",
    import.meta.url,
  ),
  "utf8",
);

test("le rappel de match est déclenché à partir de 10 h", () => {
  assert.match(migration, /time '10:00'/);
  assert.match(
    migration,
    /pelote-manager-tournament-match-day-reminders/,
  );
  assert.match(migration, /'\*\/15 \* \* \* \*'/);
  assert.match(
    migration,
    /publish_due_tournament_match_day_reminders\(\)/,
  );
});

test("le message contient série poule adversaire terrain et horaire", () => {
  assert.match(migration, /Votre match aujourd’hui/);
  assert.match(migration, /Série /);
  assert.match(migration, /Poule /);
  assert.match(migration, /Adversaires : /);
  assert.match(migration, /Terrain : /);
  assert.match(migration, /Horaire : /);
  assert.match(migration, /tournament_team_public_label/);
});

test("le rappel est ciblé sur les deux joueurs de l équipe et idempotent", () => {
  assert.match(migration, /tournament_match_reminder_events/);
  assert.match(
    migration,
    /primary key \(match_id, team_id, reminder_kind\)/,
  );
  assert.match(
    migration,
    /where player\.team_id = target_team_id[\s\S]*player\.tournament_id = target\.tournament_id/,
  );
  assert.match(
    migration,
    /values \(match\.team_a_id\), \(match\.team_b_id\)/,
  );
});

test("les joueurs extérieurs avec un compte peuvent recevoir le push", () => {
  assert.match(
    migration,
    /alter column club_member_id drop not null/,
  );
  assert.match(
    migration,
    /profile_id_at_publication = auth\.uid\(\)/,
  );
  assert.match(
    migration,
    /lower\(btrim\(profile\.email\)\) = lower\(btrim\(player\.email\)\)/,
  );
  assert.match(
    migration,
    /communication_deliveries_external_profile_unique/,
  );
});

test("le clic ouvre Mes tournois", () => {
  assert.match(
    migration,
    /when match_event\.match_id is not null then '\/mon-espace\/tournois'/,
  );
});
