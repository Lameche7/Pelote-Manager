import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const load = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = load("../src/features/network/pages/NetworkVideosPage.tsx");
const navigation = load(
  "../src/features/network/components/NetworkNavigation.tsx",
);
const hero = load("../src/features/network/components/NetworkHero.tsx");
const router = load("../src/app/router.tsx");

test("Pilotoki Network publishes a dedicated Videos page from its navigation", () => {
  assert.match(navigation, /to="\/reseau\/videos">Vidéos/);
  assert.match(router, /path: "\/reseau\/videos", element: <NetworkVideosPage/);
  assert.match(hero, /variant === "videos"/);
  assert.match(page, /<NetworkNavigation \/>/);
  assert.doesNotMatch(page, /<NetworkHero variant="videos"/);
});

test("Video page displays truthful empty states, not fictional broadcasts", () => {
  assert.match(page, /id="directs"/);
  assert.match(page, /id="replays"/);
  assert.match(page, /hasLive \|\| !hasReplay/);
  assert.match(page, /hasReplay = visible\.some/);
  assert.match(page, /Aucun direct disponible actuellement/);
  assert.match(page, /Les premières vidéos arrivent bientôt/);
  assert.match(page, /Bientôt disponible/);
  assert.match(page, /UCAIME5j0y9DdiEQNyttO_jw/);
  assert.doesNotMatch(page, /youtube\.com\/embed/);
});

test("diagnostic: show formatter differences for videos page", async () => {
  const prettier = await import("prettier");
  const expected = await prettier.format(page, {
    filepath: "src/features/network/pages/NetworkVideosPage.tsx",
  });
  const originalLines = page.split("\n");
  const expectedLines = expected.split("\n");
  for (let i = 0; i < Math.max(originalLines.length, expectedLines.length); i += 1) {
    if (originalLines[i] !== expectedLines[i]) {
      console.log("PRETTIER_DIFF", JSON.stringify({
        line: i + 1,
        actual: originalLines.slice(Math.max(0, i - 3), i + 10),
        expected: expectedLines.slice(Math.max(0, i - 3), i + 10),
      }));
      break;
    }
  }
});
