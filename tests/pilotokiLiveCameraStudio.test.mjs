import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const studio = read(
  "../src/features/admin/live/components/PilotokiLiveCameraStudio.tsx",
);
const admin = read(
  "../src/features/admin/live/pages/AdminLiveSettingsPage.tsx",
);

test("Camera preview requires a deliberate browser camera permission", () => {
  assert.match(studio, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(studio, /window\.isSecureContext/);
  assert.match(studio, /onClick=\{\(\) => void open\(facing\)\}/);
  assert.match(studio, /facingMode:/);
  assert.match(studio, /playsInline/);
  assert.match(studio, /muted/);
});

test("Preview does not transmit video, expose an RTMP key, or fake live streaming", () => {
  assert.match(studio, /APERÇU LOCAL — PAS EN DIRECT/);
  assert.match(studio, /Aucun flux n'est transmis/);
  assert.doesNotMatch(studio, /fetch\(/);
  assert.doesNotMatch(studio, /RTMP_KEY|streamName|MediaRecorder|WebSocket/);
});

test("Camera tracks always stop when user closes camera or navigates away", () => {
  assert.match(
    studio,
    /getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/,
  );
  assert.match(studio, /requestIdRef\.current \+= 1/);
  assert.match(studio, /useEffect\(\(\) => \{/);
  assert.match(studio, /onClick=\{stop\}/);
  assert.match(studio, /track\.enabled = enabled/);
});

test("Camera is available only in authenticated connected club admin UI", () => {
  assert.match(admin, /settings\?\.connectionStatus === "connected"/);
  assert.match(admin, /<PilotokiLiveCameraStudio \/>/);
});

test("Switching releases previous tracks and retries only transient busy-camera errors", () => {
  assert.match(studio, /if \(openingRef\.current\) return/);
  assert.match(studio, /stop\(\);\s+const requestId = requestIdRef\.current/);
  assert.match(studio, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/);
  assert.match(studio, /NotReadableError/);
  assert.match(studio, /TrackStartError/);
  assert.match(studio, /if \(!isBusy \|\| attempt === 2\) throw reason/);
  assert.match(studio, /requestId !== requestIdRef\.current/);
  assert.match(studio, /stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
});
