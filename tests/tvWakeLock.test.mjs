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

  assert.match(wakeLock, /if \(!wakeLock\) return/);
  assert.match(wakeLock, /catch \{/);
  assert.match(wakeLock, /Mode TV reste fonctionnel/i);
});

test("Amazon Silk reçoit un garde-fou média en plus du Wake Lock", async () => {
  const wakeLock = await read("../src/features/tv/tvWakeLock.ts");

  assert.match(wakeLock, /SILK_USER_AGENT_PATTERN = \/Silk\\\//);
  assert.match(wakeLock, /setupSilkMediaKeepAlive\(\)/);
  assert.match(wakeLock, /canvas\.captureStream/);
  assert.match(wakeLock, /video\.muted = true/);
  assert.match(wakeLock, /video\.autoplay = true/);
  assert.match(wakeLock, /await video\.play\(\)/);
  assert.match(wakeLock, /pointerdown/);
  assert.match(wakeLock, /keydown/);
  assert.match(wakeLock, /SILK_FRAME_INTERVAL_MS/);
  assert.match(wakeLock, /stream\.getTracks\(\)/);
});
