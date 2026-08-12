import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicationMigration = await readFile(
  new URL(
    "../supabase/migrations/20260812133000_publish_tournament_planning_to_calendar.sql",
    import.meta.url,
  ),
  "utf8",
);
const eventAdminMigration = await readFile(
  new URL(
    "../supabase/migrations/20260812133500_hide_tournament_match_events_from_event_admin.sql",
    import.meta.url,
  ),
  "utf8",
);
const service = await readFile(
  new URL(
    "../src/features/admin/tournaments/services/adminTournamentPublicationService.ts",
    import.meta.url,
  ),
  "utf8",
);
const page = await readFile(
  new URL(
    "../src/features/admin/tournaments/pages/AdminTournamentPublicationPage.tsx",
    import.meta.url,
  ),
  "utf8",
);
const routes = await readFile(
  new URL("../src/shared/config/routes.ts", import.meta.url),
  "utf8",
);
const router = await readFile(
  new URL("../src/app/router.tsx", import.meta.url),
  "utf8",
);

test("la publication passe par l Event Engine et non par un calendrier parallèle", () => {
  assert.match(
    publicationMigration,
    /create table public\.tournament_match_events/i,
  );
  assert.match(publicationMigration, /insert into public\.events/i);
  assert.match(publicationMigration, /insert into public\.event_resources/i);
  assert.match(publicationMigration, /sync_event_occupations/i);
  assert.doesNotMatch(
    publicationMigration,
    /insert into public\.calendar_occupations/i,
  );
});

test("la publication est atomique et refuse les conflits existants", () => {
  assert.match(publicationMigration, /for update/i);
  assert.match(publicationMigration, /calendar_occupations/i);
  assert.match(
    publicationMigration,
    /Tournament publication conflicts with calendar/,
  );
  assert.match(publicationMigration, /status = 'planning_published'/i);
  assert.match(publicationMigration, /planning_published/);
});

test("un planning publié peut être retiré du calendrier pour être modifié", () => {
  assert.match(publicationMigration, /admin_unpublish_tournament_planning/i);
  assert.match(publicationMigration, /publication_status = 'archived'/i);
  assert.match(publicationMigration, /status = 'planning_generated'/i);
  assert.match(publicationMigration, /planning_unpublished/);
});

test("les événements de matchs sont protégés contre l édition générique", () => {
  assert.match(publicationMigration, /protect_tournament_managed_event/i);
  assert.match(
    publicationMigration,
    /Tournament-managed event must be changed from tournament planning/,
  );
  assert.match(eventAdminMigration, /not exists/i);
  assert.match(eventAdminMigration, /tournament_match_events/i);
});

test("l administration expose une étape Publication distincte du Planning", () => {
  assert.match(service, /admin_list_tournament_publications/);
  assert.match(service, /admin_get_tournament_publication_preview/);
  assert.match(service, /admin_publish_tournament_planning/);
  assert.match(service, /admin_unpublish_tournament_planning/);
  assert.match(page, /Publication du planning/);
  assert.match(page, /Publier .* matchs dans le calendrier/);
  assert.match(page, /Retirer du calendrier pour modifier/);
  assert.match(
    routes,
    /adminTournamentPublication:\s*"\/admin\/tournois\/publication"/,
  );
  assert.match(router, /AdminTournamentPublicationPage/);
});
