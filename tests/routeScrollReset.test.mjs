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

test("une vraie navigation remet la nouvelle page en haut", () => {
  assert.match(scrollReset, /useNavigationType/);
  assert.match(scrollReset, /if \(navigationType === "POP"\) return/);
  assert.match(
    scrollReset,
    /window\.scrollTo\(\{ top: 0, left: 0, behavior: "auto" \}\)/,
  );
  assert.match(
    scrollReset,
    /\[location\.pathname, location\.hash, navigationType\]/,
  );
  assert.doesNotMatch(scrollReset, /location\.search/);
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
