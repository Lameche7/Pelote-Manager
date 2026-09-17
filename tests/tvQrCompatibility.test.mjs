import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [compatibilitySource, mainSource] = await Promise.all([
  read("../src/features/tv/tvQrCompatibility.ts"),
  read("../src/main.tsx"),
]);

test("le mode TV remplace les QR QuickChart SVG par des PNG", () => {
  assert.match(compatibilitySource, /quickchart\.io/);
  assert.match(compatibilitySource, /searchParams\.get\("format"\) !== "svg"/);
  assert.match(compatibilitySource, /searchParams\.set\("format", "png"\)/);
});

test("la compatibilité QR reste limitée aux routes du mode TV", () => {
  assert.match(
    compatibilitySource,
    /window\.location\.pathname\.startsWith\("\/tv\/"\)/,
  );
  assert.match(mainSource, /setupTvQrCompatibility\(\)/);
});
