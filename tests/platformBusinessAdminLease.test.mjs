import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const endpoint = readFileSync(
  new URL(
    "../supabase/functions/platform-business-admin-lease/index.ts",
    import.meta.url,
  ),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261112210000_platform_admin_short_lived_leases.sql",
    import.meta.url,
  ),
  "utf8",
);

test("le serveur exige deux identités et un rôle plateforme", () => {
  assert.match(endpoint, /platform\.auth\.getUser\(platformToken\)/);
  assert.match(endpoint, /business\.auth\.getUser\(businessToken\)/);
  assert.match(endpoint, /platform\.rpc\("platform_is_admin"\)/);
  assert.match(endpoint, /platformEmail !== businessEmail/);
});

test("l'émission est désactivée par défaut", () => {
  assert.match(endpoint, /PLATFORM_ADMIN_LEASES_ENABLED/);
  assert.match(endpoint, /requested_seconds: 300/);
  assert.doesNotMatch(endpoint, /request\.json\(/);
});

test("les autorisations expirent et sont révocables", () => {
  assert.match(migration, /expires_at > now\(\)/);
  assert.match(migration, /revoked_at is null/);
  assert.match(migration, /interval '15 minutes'/);
  assert.match(migration, /revoke_platform_admin_lease/);
});

test("les utilisateurs ne peuvent pas s'attribuer des droits", () => {
  assert.match(migration, /revoke all on pilotoki_private\.platform_admin_leases/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.issue_platform_admin_lease/);
});
