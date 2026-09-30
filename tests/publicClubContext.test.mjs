import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260930084500_public_club_context.sql",
    import.meta.url,
  ),
  "utf8",
);
const home = fs.readFileSync(
  new URL("../src/features/home/pages/HomePage.tsx", import.meta.url),
  "utf8",
);
const branding = fs.readFileSync(
  new URL(
    "../src/features/home/services/clubBrandingService.ts",
    import.meta.url,
  ),
  "utf8",
);
const events = fs.readFileSync(
  new URL(
    "../src/features/home/services/publicEventService.ts",
    import.meta.url,
  ),
  "utf8",
);
const tournaments = fs.readFileSync(
  new URL(
    "../src/features/tournaments/services/tournamentService.ts",
    import.meta.url,
  ),
  "utf8",
);
const notifications = fs.readFileSync(
  new URL(
    "../src/features/notifications/services/notificationService.ts",
    import.meta.url,
  ),
  "utf8",
);

test("la home publique peut être scindée par slug de club", () => {
  assert.match(home, /URLSearchParams\(window\.location\.search\)/);
  assert.match(home, /get\("club"\)/);
  assert.match(home, /publicClubSlug/);
});

test("branding, événements, tournois et bandeaux utilisent le même slug", () => {
  assert.match(branding, /get_public_club_branding_for_slug/);
  assert.match(events, /list_upcoming_events_for_club/);
  assert.match(tournaments, /list_public_tournaments_for_club/);
  assert.match(notifications, /list_my_home_banners_for_club/);
  assert.match(home, /HomeTournaments clubSlug=\{publicClubSlug\}/);
});

test("les nouvelles RPC publiques filtrent réellement par clubs.slug", () => {
  assert.match(
    migration,
    /get_public_club_branding_for_slug[\s\S]*club\.slug = nullif\(btrim\(target_slug\), ''\)/,
  );
  assert.match(
    migration,
    /list_upcoming_events_for_club[\s\S]*club\.slug = nullif\(btrim\(target_slug\), ''\)/,
  );
  assert.match(
    migration,
    /list_public_tournaments_for_club[\s\S]*where tournament\.club_id = target_club_id/,
  );
});

test("les bandeaux privés restent réservés aux utilisateurs authentifiés", () => {
  assert.match(
    migration,
    /revoke all on function public\.list_my_home_banners_for_club\(text\)[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /grant execute on function public\.list_my_home_banners_for_club\(text\)[\s\S]*to authenticated/,
  );
});
