import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [scrollReset, mainLayout] = await Promise.all([
  readFile(
    new URL("../src/app/router/RouteScrollReset.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/app/layouts/MainLayout.tsx", import.meta.url),
    "utf8",
  ),
]);

test("chaque navigation remet tous les niveaux de scroll en haut", () => {
  assert.doesNotMatch(scrollReset, /useNavigationType/);
  assert.match(scrollReset, /window\.history\.scrollRestoration = "manual"/);
  assert.match(scrollReset, /window\.scrollTo\(0, 0\)/);
  assert.match(scrollReset, /document\.documentElement\.scrollTop = 0/);
  assert.match(scrollReset, /document\.body\.scrollTop = 0/);
  assert.match(scrollReset, /\.app-main, \.admin-shell__content/);
  assert.match(scrollReset, /container\.scrollTop = 0/);
  assert.match(scrollReset, /location\.search/);
  assert.match(scrollReset, /location\.key/);
});

test("le reset est répété après le rendu pour contrer une restauration tardive", () => {
  assert.match(
    scrollReset,
    /window\.requestAnimationFrame\(\(\) => \{[\s\S]*resetScrollPositions\(\)[\s\S]*window\.requestAnimationFrame\(resetScrollPositions\)/,
  );
});

test("les ancres restent prioritaires sur le retour en haut", () => {
  assert.match(scrollReset, /if \(location\.hash\)/);
  assert.match(scrollReset, /scrollToHashTarget\(location\.hash\)/);
  assert.match(scrollReset, /scrollIntoView\(\{ block: "start" \}\)/);
});

test("le reset est actif sur tout le layout principal", () => {
  assert.match(
    mainLayout,
    /import \{ RouteScrollReset \} from "@\/app\/router\/RouteScrollReset";/,
  );
  assert.match(mainLayout, /<RouteScrollReset \/>/);
});
