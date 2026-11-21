import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const load = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const assistant = load(
  "../src/features/admin/live/components/PilotokiLiveLaunchAssistant.tsx",
);
const page = load("../src/features/admin/live/pages/AdminLiveSettingsPage.tsx");

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
  assert.doesNotMatch(
    assistant,
    /streamName|streamKey|token|RTMPS_URL|authorization:/i,
  );
  assert.match(assistant, /ne déclenche ni n'arrête un direct automatiquement/);
});

test("Assisted workflow still requires deliberate YouTube live confirmation", () => {
  assert.match(assistant, /Passer au direct/);
  assert.match(assistant, /page spectateur/);
  assert.match(assistant, /Upstream Live Studio/);
});


test("Pilot selects an explicit Upstream studio without starting it", () => {
  assert.ok(assistant.includes("stream/${validStream.id}/builder?tab=studio"));
  assert.ok(assistant.includes("selectedStreamId"));
  assert.ok(assistant.includes("Choisir explicitement le bon flux"));
  assert.ok(assistant.includes("streams.find("));
  assert.ok(!assistant.includes("UPSTREAM_API_FULL_TOKEN"));
  assert.ok(!assistant.includes("startUpstreamStream"));
});

test("Camera invitation remains ephemeral and domain restricted", () => {
  assert.ok(assistant.includes("setInviteUrl"));
  assert.ok(assistant.includes("studio\\.upstream\\.so\\/join"));
  assert.ok(assistant.includes("navigator.clipboard.writeText"));
  assert.ok(assistant.includes("n'est pas enregistré dans Pilotoki"));
  assert.doesNotMatch(assistant, /localStorage|sessionStorage|supabase/);
  assert.ok(page.includes("settings.canConnectGoogle ? (upstreamStreams ?? []) : []"));
});

test("temporary Prettier source capture", async () => {
  const prettier = await import("prettier");
  for (const [name, path] of [
    ["FMT_CAM_ASSIST", "src/features/admin/live/components/PilotokiLiveLaunchAssistant.tsx"],
    ["FMT_CAM_ADMIN", "src/features/admin/live/pages/AdminLiveSettingsPage.tsx"],
    ["FMT_CAM_TEST", "tests/pilotokiLiveLaunchAssistant.test.mjs"],
  ]) {
    const content = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    const formatted = await prettier.format(content, { filepath: path });
    console.log(name, Buffer.from(formatted).toString("base64"));
  }
});
