import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260930003000_network_user_events_notifications.sql",
    import.meta.url,
  ),
  "utf8",
);

test("les événements membres utilisent l'identité Network du club", () => {
  assert.match(
    migration,
    /profile_club_member_id\(auth\.uid\(\), events\.club_id\)/,
  );
  assert.doesNotMatch(
    migration,
    /join public\.club_members as members\s+on members\.id = profiles\.member_id/,
  );
});

test("les opérations notification ciblent la fiche locale du club", () => {
  assert.match(
    migration,
    /deliveries\.club_member_id =\s*public\.profile_club_member_id\(auth\.uid\(\), deliveries\.club_id\)/,
  );
  assert.match(migration, /mark_my_notification_read/);
  assert.match(migration, /delete_my_notification/);
});

test("le compteur et les bandeaux reposent sur la liste Network v2", () => {
  assert.match(
    migration,
    /from public\.list_my_notifications_v2\(\) as notification/,
  );
  assert.match(migration, /count_my_unread_notifications/);
  assert.match(migration, /list_my_home_banners/);
});

test("les RPC privées ne sont pas exécutables par anon", () => {
  for (const fn of [
    "list_my_notifications",
    "count_my_unread_notifications",
    "mark_my_notification_read",
    "delete_my_notification",
    "list_my_home_banners",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `revoke all on function public\\.${fn}[^;]*[\\s\\S]*?from public, anon, authenticated`,
      ),
    );
  }
});
