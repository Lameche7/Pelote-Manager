import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL(
    "../supabase/functions/platform-business-identity/index.ts",
    import.meta.url,
  ),
  "utf8",
);

test("la liaison exige deux sessions authentifiées distinctes", () => {
  assert.match(source, /platform\.auth\.getUser\(platformToken\)/);
  assert.match(source, /business\.auth\.getUser\(businessToken\)/);
  assert.match(source, /X-Business-Authorization/);
  assert.match(source, /platform\.rpc\("platform_is_admin"\)/);
});

test("la liaison exige deux emails vérifiés et concordants", () => {
  assert.match(source, /platformUser\.email_confirmed_at/);
  assert.match(source, /businessUser\.email_confirmed_at/);
  assert.match(source, /platformEmail !== businessEmail/);
});

test("la preuve de liaison ne confère jamais de droits inter-clubs", () => {
  assert.match(source, /crossClubAdministrationEnabled: false/);
  assert.doesNotMatch(source, /\.from\(|\.insert\(|\.update\(|\.delete\(/);
  assert.match(source, /request\.method !== "POST"/);
});
