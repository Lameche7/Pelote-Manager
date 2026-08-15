import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("les notifications de tournoi exposent un lien direct vers l'inscription", async () => {
  const [migration, service, notificationsPage, serviceWorker] =
    await Promise.all([
      read(
        "../supabase/migrations/20260815104500_add_tournament_notification_deep_links.sql",
      ),
      read("../src/features/notifications/services/notificationService.ts"),
      read("../src/features/notifications/pages/NotificationsPage.tsx"),
      read("../public/sw.js"),
    ]);

  assert.match(migration, /list_my_notifications_v2/);
  assert.match(migration, /tournament_notification_events/);
  assert.match(migration, /\/tournois\/%s#inscription/);
  assert.match(service, /list_my_notifications_v2/);
  assert.match(service, /actionUrl/);
  assert.match(notificationsPage, /communication/);
  assert.match(notificationsPage, /notification\.actionUrl/);
  assert.match(notificationsPage, /Voir le tournoi et l’inscription/);
  assert.match(serviceWorker, /communication:/);
  assert.match(serviceWorker, /\?communication=/);
});

test("une inscription enregistrée reste visiblement confirmée et modifiable avant clôture", async () => {
  const detailPage = await read(
    "../src/features/tournaments/pages/TournamentDetailPage.tsx",
  );

  assert.match(detailPage, /Votre équipe est bien inscrite au tournoi/);
  assert.match(
    detailPage,
    /modifier votre équipe ou vos[\s\S]*disponibilités autant de fois que nécessaire/,
  );
  assert.match(detailPage, /registrationClosesAt/);
  assert.match(detailPage, /window\.location\.hash !== "#inscription"/);
  assert.match(detailPage, /scrollIntoView/);
});
