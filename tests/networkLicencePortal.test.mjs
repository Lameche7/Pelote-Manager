import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260929234500_network_licence_portal.sql",
    import.meta.url,
  ),
  "utf8",
);
const service = fs.readFileSync(
  new URL(
    "../src/features/licences/services/licenceService.ts",
    import.meta.url,
  ),
  "utf8",
);
const page = fs.readFileSync(
  new URL("../src/features/licences/pages/MyLicencePage.tsx", import.meta.url),
  "utf8",
);

test("le portail licence est explicitement scoped par club", () => {
  assert.match(migration, /list_my_licence_clubs/);
  assert.match(migration, /get_my_licence_portal_for_club/);
  assert.match(migration, /start_my_licence_request_for_club/);
  assert.match(migration, /profile_club_member_id\(actor_id, target_club_id\)/);
});

test("les nouvelles RPC licence ne sont pas exposées à anon", () => {
  assert.match(
    migration,
    /revoke all on function public\.list_my_licence_clubs\(\)[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /revoke all on function public\.get_my_licence_portal_for_club\(uuid\)[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /revoke all on function public\.start_my_licence_request_for_club\(uuid, jsonb\)[\s\S]*from public, anon, authenticated/,
  );
});

test("le front transmet toujours le club cible", () => {
  assert.match(service, /get_my_licence_portal_for_club/);
  assert.match(service, /start_my_licence_request_for_club/);
  assert.match(service, /target_club_id: clubId/);
  assert.match(page, /selectedClubId/);
  assert.match(page, /Club concerné/);
});

test("le mode de paiement est résolu depuis le paiement préparé", () => {
  assert.match(service, /getPaymentMode\(paymentId\)/);
  assert.match(service, /target_payment_id: paymentId/);
  assert.doesNotMatch(service, /getPaymentMode: async \(\)/);
});
