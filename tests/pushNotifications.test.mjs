import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migrationPath =
  "../supabase/migrations/20260813114000_add_web_push_notifications.sql";

test("la PWA expose un manifeste et un service worker Push", async () => {
  const [manifest, serviceWorker, indexHtml, main] = await Promise.all([
    read("../public/manifest.webmanifest"),
    read("../public/sw.js"),
    read("../index.html"),
    read("../src/main.tsx"),
  ]);

  assert.match(manifest, /"display"\s*:\s*"standalone"/i);
  assert.match(manifest, /\/pwa-icon\.svg/);
  assert.match(serviceWorker, /addEventListener\("push"/);
  assert.match(serviceWorker, /showNotification/);
  assert.match(serviceWorker, /addEventListener\("notificationclick"/);
  assert.match(serviceWorker, /\/mon-espace\/notifications/);
  assert.match(indexHtml, /manifest\.webmanifest/);
  assert.match(main, /serviceWorker\.register\("\/sw\.js"\)/);
});

test("les abonnements Push sont stockés par profil et par appareil", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /create table public\.push_subscriptions/i);
  assert.match(migration, /profile_id uuid not null references public\.profiles/i);
  assert.match(migration, /endpoint text not null unique/i);
  assert.match(migration, /p256dh text not null/i);
  assert.match(migration, /auth text not null/i);
  assert.match(migration, /register_push_subscription/i);
  assert.match(migration, /disable_push_subscription/i);
});

test("les tentatives Push sont idempotentes par livraison et appareil", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /create table public\.push_delivery_attempts/i);
  assert.match(
    migration,
    /unique \(delivery_id, subscription_id\)/i,
  );
  assert.match(migration, /'pending'/);
  assert.match(migration, /'sent'/);
  assert.match(migration, /'failed'/);
  assert.match(migration, /'invalid'/);
});

test("le navigateur enregistre et désactive son abonnement via les RPC", async () => {
  const service = await read(
    "../src/features/notifications/services/pushNotificationService.ts",
  );

  assert.match(service, /Notification\.requestPermission/);
  assert.match(service, /pushManager\.subscribe/);
  assert.match(service, /applicationServerKey/);
  assert.match(service, /register_push_subscription/);
  assert.match(service, /disable_push_subscription/);
  assert.match(service, /Sur iPhone ou iPad/);
});

test("Mon espace propose l activation Push sans supprimer l historique interne", async () => {
  const [page, settings, notificationService] = await Promise.all([
    read("../src/features/notifications/pages/NotificationsPage.tsx"),
    read("../src/features/notifications/components/PushNotificationSettings.tsx"),
    read("../src/features/notifications/services/notificationService.ts"),
  ]);

  assert.match(page, /PushNotificationSettings/);
  assert.match(settings, /Activer les notifications/);
  assert.match(settings, /Désactiver sur cet appareil/);
  assert.match(settings, /Partager → Sur l’écran d’accueil/);
  assert.match(notificationService, /list_my_notifications/);
  assert.match(notificationService, /count_my_unread_notifications/);
});

test("le dispatch Push part des communications et non des modules métier", async () => {
  const sender = await read(
    "../supabase/functions/send-push-notifications/index.ts",
  );

  assert.match(sender, /club_communications/);
  assert.match(sender, /communication_deliveries/);
  assert.match(sender, /push_subscriptions/);
  assert.match(sender, /push_delivery_attempts/);
  assert.match(sender, /sendNotification/);
  assert.match(sender, /statusCode === 404/);
  assert.match(sender, /statusCode === 410/);
  assert.match(sender, /x-pelote-push-secret/);
});

test("la clé privée VAPID reste exclusivement côté serveur", async () => {
  const [browserService, pushConfig, sender] = await Promise.all([
    read("../src/features/notifications/services/pushNotificationService.ts"),
    read("../supabase/functions/push-config/index.ts"),
    read("../supabase/functions/send-push-notifications/index.ts"),
  ]);

  assert.doesNotMatch(browserService, /WEB_PUSH_VAPID_PRIVATE_KEY/);
  assert.doesNotMatch(pushConfig, /WEB_PUSH_VAPID_PRIVATE_KEY/);
  assert.match(sender, /WEB_PUSH_VAPID_PRIVATE_KEY/);
  assert.match(pushConfig, /WEB_PUSH_VAPID_PUBLIC_KEY/);
});
