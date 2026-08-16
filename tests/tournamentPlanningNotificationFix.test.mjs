import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260816215500_fix_tournament_planning_notification.sql",
    import.meta.url,
  ),
  "utf8",
);

test("la publication du planning passe par une fonction métier appelable", () => {
  assert.match(
    migration,
    /create or replace function public\.publish_tournament_planning_notification\(/,
  );
  assert.match(migration, /tournament\.status = 'planning_published'/);
  assert.match(migration, /return target_recipient_count/);
});

test("le trigger reste protégé sans masquer les erreurs d'un appel manuel", () => {
  assert.match(
    migration,
    /create or replace function public\.notify_tournament_players_after_planning_publication\(\)/,
  );
  assert.match(
    migration,
    /perform public\.publish_tournament_planning_notification\(new\.id\)/,
  );
  assert.match(migration, /exception when others then/);
});

test("les anciens event kind de rappel restent autorisés", () => {
  assert.match(migration, /'registration_last_day_registered'/);
  assert.match(migration, /'registration_last_day_unregistered'/);
  assert.match(migration, /'planning_published'/);
});

test("les deep links admin match et planning sont tous conservés", () => {
  assert.match(
    migration,
    /when admin_event\.tournament_id is not null then '\/admin\/tournois'/,
  );
  assert.match(
    migration,
    /when match_event\.match_id is not null then '\/mon-espace\/tournois'/,
  );
  assert.match(
    migration,
    /when tournament_event\.event_kind = 'planning_published' then '\/mon-espace\/tournois'/,
  );
});
