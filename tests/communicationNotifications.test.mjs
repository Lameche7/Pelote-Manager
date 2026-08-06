import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  "supabase/migrations/20260806113000_add_communication_notifications.sql",
  "utf8",
);
const adminService = await readFile(
  "src/features/admin/services/communicationAdminService.ts",
  "utf8",
);
const notificationService = await readFile(
  "src/features/notifications/services/notificationService.ts",
  "utf8",
);
const router = await readFile("src/app/router.tsx", "utf8");
const mainLayout = await readFile("src/app/layouts/MainLayout.tsx", "utf8");
const homePage = await readFile("src/features/home/pages/HomePage.tsx", "utf8");

test("la communication possède une source, des livraisons et un audit isolés par club", () => {
  for (const table of [
    "club_communications",
    "communication_deliveries",
    "communication_audit_log",
  ]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
  }
  assert.match(migration, /club_id uuid not null references public\.clubs/);
  assert.match(migration, /communication_id, club_member_id/);
  assert.match(migration, /communication\.manage/);
});

test("un brouillon ne diffuse rien et la publication photographie chaque licencié actif", () => {
  assert.match(
    migration,
    /status public\.communication_status not null default 'draft'/,
  );
  assert.match(
    migration,
    /create function public\.admin_publish_communication/,
  );
  assert.match(migration, /insert into public\.communication_deliveries/);
  assert.match(migration, /members\.is_active/);
  assert.match(migration, /profile_id_at_publication/);
  assert.match(migration, /email_snapshot/);
  assert.match(migration, /not_configured/);
});

test("la publication est idempotente et ne duplique jamais un destinataire", () => {
  assert.match(
    migration,
    /if previous_communication\.status = 'published' then\s+return;/,
  );
  assert.match(migration, /unique \(communication_id, club_member_id\)/);
  assert.match(
    migration,
    /on conflict \(communication_id, club_member_id\) do nothing/,
  );
});

test("un licencié ne consulte et ne modifie que ses propres livraisons", () => {
  assert.match(migration, /profiles\.id = auth\.uid\(\)/);
  assert.match(migration, /deliveries\.club_member_id = members\.id/);
  assert.match(migration, /create function public\.list_my_notifications/);
  assert.match(migration, /create function public\.mark_my_notification_read/);
  assert.match(migration, /members\.is_active/);
  assert.match(
    migration,
    /revoke all on table public\.communication_deliveries from public, anon, authenticated/,
  );
});

test("le compteur et le bandeau ignorent les messages archivés ou expirés", () => {
  assert.match(
    migration,
    /create function public\.count_my_unread_notifications/,
  );
  assert.match(migration, /communications\.status = 'published'/);
  assert.match(
    migration,
    /communications\.expires_at is null or communications\.expires_at > now\(\)/,
  );
  assert.match(migration, /create function public\.list_my_home_banners/);
  assert.match(migration, /communications\.show_on_home/);
});

test("l’administration et l’espace licencié utilisent uniquement les RPC prévues", () => {
  for (const rpc of [
    "admin_list_communications",
    "admin_save_communication",
    "admin_publish_communication",
    "admin_archive_communication",
  ]) {
    assert.match(adminService, new RegExp(`supabase\\.rpc\\(\"${rpc}\"`));
  }
  for (const rpc of [
    "list_my_notifications",
    "count_my_unread_notifications",
    "mark_my_notification_read",
    "list_my_home_banners",
  ]) {
    assert.match(
      notificationService,
      new RegExp(`supabase\\.rpc\\(\"${rpc}\"`),
    );
  }
});

test("les routes, le compteur et le bandeau remplacent les écrans factices", () => {
  assert.match(router, /AdminCommunicationPage/);
  assert.match(router, /NotificationsPage/);
  assert.doesNotMatch(router, /AdminComingSoonPage title="Communication"/);
  assert.match(mainLayout, /countUnread/);
  assert.match(mainLayout, /app-navigation__badge/);
  assert.match(homePage, /listHomeBanners/);
  assert.match(homePage, /Voir mes notifications/);
});
