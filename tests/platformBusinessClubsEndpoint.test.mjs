import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL(
    "../supabase/functions/platform-business-clubs/index.ts",
    import.meta.url,
  ),
  "utf8",
);

test("le catalogue métier valide la session et le rôle plateforme côté serveur", () => {
  assert.match(source, /auth\.getUser\(match\[1\]\)/);
  assert.match(source, /rpc\("platform_is_admin"\)/);
  assert.match(source, /isAdmin !== true/);
  assert.match(source, /return json\(401/);
  assert.match(source, /return json\(403/);
});

test("la clé privilégiée métier reste côté fonction et seules les colonnes publiques sont lues", () => {
  assert.match(
    source,
    /Deno\.env\.get\("BUSINESS_SUPABASE_SERVICE_ROLE_KEY"\)/,
  );
  assert.match(source, /\.from\("clubs"\)/);
  assert.match(source, /\.select\("id,name,slug"\)/);
  assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
});

test("la fonction refuse les méthodes d'écriture et ne met pas les réponses en cache", () => {
  assert.match(source, /request\.method !== "GET"/);
  assert.match(source, /"Cache-Control": "no-store"/);
});
