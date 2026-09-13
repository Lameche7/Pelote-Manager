import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
const viewport = await readFile(
  new URL("../src/styles/viewport.css", import.meta.url),
  "utf8",
);

test("charge la protection globale du viewport", () => {
  assert.match(main, /import "\.\/styles\/viewport\.css";/);
});

test("empêche le viewport global de dériver horizontalement", () => {
  assert.match(viewport, /html[\s\S]*overflow-x: hidden;/);
  assert.match(viewport, /overflow-x: clip;/);
  assert.match(viewport, /overscroll-behavior-x: none;/);
  assert.match(viewport, /\.app-layout,[\s\S]*\.app-main[\s\S]*min-width: 0;/);
  assert.match(viewport, /\.app-layout,[\s\S]*\.app-main[\s\S]*max-width: 100%;/);
});
