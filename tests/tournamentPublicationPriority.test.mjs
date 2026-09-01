import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260901153000_tournament_publication_priority.sql",
    import.meta.url,
  ),
  "utf8",
);
const service = readFileSync(
  new URL(
    "../src/features/admin/tournaments/services/adminTournamentPublicationService.ts",
    import.meta.url,
  ),
  "utf8",
);
const page = readFileSync(
  new URL(
    "../src/features/admin/tournaments/pages/AdminTournamentPublicationPage.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("la publication prioritaire reste transactionnelle et délègue au moteur normal", () => {
  assert.match(migration, /^begin;/i);
  assert.match(migration, /admin_publish_tournament_planning_priority/);
  assert.match(
    migration,
    /published_count := public\.admin_publish_tournament_planning\(target_tournament\.id\)/,
  );
  assert.match(migration, /commit;\s*$/i);
});

test("une réservation concurrente est annulée et auditée sans notifier un faux créneau libre", () => {
  assert.match(migration, /status in \('pending', 'confirmed'\)/);
  assert.match(migration, /Priorité tournoi/);
  assert.match(migration, /cancelled_by_tournament_priority/);
  assert.match(migration, /superseded_by_tournament/);
  assert.doesNotMatch(
    migration,
    /publish_released_reservation_slot_notification/,
  );
});

test("les autres sources calendrier cèdent la place au tournoi", () => {
  assert.match(migration, /admin_unpublish_tournament_planning/);
  assert.match(migration, /publication_status = 'archived'/);
  assert.match(migration, /sync_event_occupations/);
  assert.match(migration, /calendar_occupation_audit_log/);
});

test("l'interface publie en priorité au lieu de bloquer sur les impacts", () => {
  assert.match(service, /admin_publish_tournament_planning_priority/);
  assert.match(service, /publishPriority/);
  assert.match(
    page,
    /preview\?\.tournament\.status === "planning_generated" && complete/,
  );
  assert.match(page, /Publier \$\{preview\.matchCount\} matchs en priorité/);
  assert.match(page, /Le tournoi est prioritaire/);
});
