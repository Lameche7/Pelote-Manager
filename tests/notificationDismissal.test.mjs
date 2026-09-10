import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  "supabase/migrations/20260908113000_add_notification_dismissal_and_championship_history_linking.sql",
  "utf8",
);
const service = await readFile(
  "src/features/notifications/services/notificationService.ts",
  "utf8",
);
const page = await readFile(
  "src/features/notifications/pages/NotificationsPage.tsx",
  "utf8",
);

test("une notification peut être masquée uniquement pour son destinataire", () => {
  assert.match(migration, /add column if not exists deleted_at timestamptz/);
  assert.match(
    migration,
    /create or replace function public\.delete_my_notification/,
  );
  assert.match(migration, /deliveries\.deleted_at is null/);
  assert.match(service, /supabase\.rpc\("delete_my_notification"/);
  assert.match(page, />Supprimer</);
});

test("le rattachement d’un profil propage l’identité vers l’historique championnat", () => {
  assert.match(
    migration,
    /create or replace function public\.sync_championship_player_links_from_profile/,
  );
  assert.match(
    migration,
    /after insert or update of member_id on public\.profiles/,
  );
  assert.match(migration, /link_status = 'verified'/);
  assert.match(
    migration,
    /championship_import_normalize\(member_row\.first_name\)/,
  );
  assert.match(
    migration,
    /championship_import_normalize\(member_row\.last_name\)/,
  );
});
