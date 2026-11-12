import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL(
    "../supabase/functions/platform-business-clubs/index.ts",
    import.meta.url,
  ),
  "utf8",
);

test("le catalogue exige une session et le rôle admin plateforme", () => {
  assert.match(source, /platform\.auth\.getUser\(match\[1\]\)/);
  assert.match(source, /platform\.rpc\("platform_is_admin"\)/);
  assert.match(source, /isAdmin !== true/);
});

test("la route est en lecture seule et ne prend aucun identifiant client", () => {
  assert.match(source, /request\.method !== "GET"/);
  assert.match(source, /\.from\("clubs"\)/);
  assert.match(source, /\.select\("id,name,slug"\)/);
  assert.doesNotMatch(source, /\.update\(|\.insert\(|\.delete\(/);
});

test("le navigateur peut réaliser le preflight sans exposer les secrets", () => {
  assert.match(source, /request\.method === "OPTIONS"/);
  assert.match(source, /Access-Control-Allow-Headers/);
  assert.match(source, /PLATFORM_ALLOWED_ORIGINS/);
  assert.doesNotMatch(source, /Access-Control-Allow-Origin": "\*"/);
});
