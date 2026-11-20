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
