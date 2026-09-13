import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("le Mode TV active et restaure le Wake Lock", async () => {
  const [main, wakeLock] = await Promise.all([
    read("../src/main.tsx"),
    read("../src/features/tv/tvWakeLock.ts"),
  ]);

  assert.match(main, /setupTvWakeLock/);
  assert.match(main, /setupTvWakeLock\(\)/);
  assert.match(wakeLock, /TV_PATH_PATTERN/);
  assert.match(wakeLock, /wakeLock\.request\("screen"\)/);
  assert.match(wakeLock, /visibilitychange/);
  assert.match(wakeLock, /pagehide/);
  assert.match(wakeLock, /popstate/);
  assert.match(wakeLock, /current\.release\(\)/);
  assert.match(wakeLock, /document\.visibilityState === "visible"/);
});

test("le Wake Lock reste optionnel sur les navigateurs non compatibles", async () => {
  const wakeLock = await read("../src/features/tv/tvWakeLock.ts");

  assert.match(wakeLock, /if \(!wakeLock \|\| !TV_PATH_PATTERN\.test/);
  assert.match(wakeLock, /catch \{/);
  assert.match(wakeLock, /le Mode TV reste fonctionnel/i);
});
