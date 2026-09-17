import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [compatibilitySource, mainSource, proxySource] = await Promise.all([
  read("../src/features/tv/tvQrCompatibility.ts"),
  read("../src/main.tsx"),
  read("../api/tv-qr.mjs"),
]);

test("le mode TV remplace les QR QuickChart par un proxy PILOTOKI de même origine", () => {
  assert.match(compatibilitySource, /quickchart\.io/);
  assert.match(compatibilitySource, /TV_QR_PROXY_PATH = "\/api\/tv-qr"/);
  assert.match(compatibilitySource, /searchParams\.get\("text"\)/);
  assert.match(compatibilitySource, /proxyUrl\.searchParams\.set\("text", text\)/);
});

test("le proxy TV renvoie explicitement un QR PNG noir sur fond blanc", () => {
  assert.match(proxySource, /https:\/\/quickchart\.io\/qr/);
  assert.match(proxySource, /url\.searchParams\.set\("format", "png"\)/);
  assert.match(proxySource, /url\.searchParams\.set\("dark", "000000"\)/);
  assert.match(proxySource, /url\.searchParams\.set\("light", "ffffff"\)/);
  assert.match(proxySource, /response\.setHeader\("Content-Type", "image\/png"\)/);
});

test("la compatibilité QR reste limitée aux routes du mode TV", () => {
  assert.match(
    compatibilitySource,
    /window\.location\.pathname\.startsWith\("\/tv\/"\)/,
  );
  assert.match(mainSource, /setupTvQrCompatibility\(\)/);
});
