import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const load = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const assistant = load(
  "../src/features/admin/live/components/PilotokiLiveLaunchAssistant.tsx",
);
const page = load(
  "../src/features/admin/live/pages/AdminLiveSettingsPage.tsx",
);

test("Broadcast controls open the matching video context instead of starting a stream", () => {
  assert.match(page, /selectedLaunchVideoId === video\.id/);
  assert.match(page, /PilotokiLiveLaunchAssistant broadcast=\{video\}/);
  assert.match(page, /Ouvrir la régie de diffusion/);
  assert.match(page, /Fermer la régie/);
});

test("Control-room links are stable known domains, external and do not leak stream credentials", () => {
  assert.match(assistant, /https:\/\/studio\.upstream\.so\//);
  assert.match(assistant, /https:\/\/studio\.youtube\.com\//);
  assert.match(assistant, /href=\{broadcast\.youtubeUrl\}/);
  assert.match(assistant, /rel="noopener noreferrer"/);
  assert.doesNotMatch(assistant, /streamName|streamKey|token|RTMPS_URL|authorization:/i);
  assert.match(assistant, /ne déclenche ni n'arrête un direct automatiquement/);
});

test("Assisted workflow still requires deliberate YouTube live confirmation", () => {
  assert.match(assistant, /Passer au direct/);
  assert.match(assistant, /page spectateur/);
  assert.match(assistant, /Upstream Live Studio/);
});

test("temporary capture of exact Prettier formatting", async () => {
  const prettier = await import("prettier");
  for (const path of [
    "src/features/admin/live/components/PilotokiLiveLaunchAssistant.tsx",
    "src/features/admin/live/pages/AdminLiveSettingsPage.tsx",
    "tests/pilotokiLiveLaunchAssistant.test.mjs",
  ]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    const formatted = await prettier.format(source, { filepath: path });
    const label = path.includes("components/")
      ? "FMT_LIVE_ASSISTANT"
      : path.endsWith("tsx")
        ? "FMT_LIVE_ADMIN"
        : "FMT_LIVE_TEST";
    console.log(label, Buffer.from(formatted).toString("base64"));
  }
});
