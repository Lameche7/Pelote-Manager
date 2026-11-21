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

test("Pilot can explicitly choose the correct studio and no stream starts automatically", () => {
  assert.match(assistant, /studio\.upstream\.so\/stream\/\$\{validStream\.id\}\/builder\?tab=studio/);
  assert.match(assistant, /selectedStreamId/);
  assert.match(assistant, /Choisir explicitement le bon flux/);
  assert.match(assistant, /streams\.find\(/);
  assert.doesNotMatch(assistant, /UPSTREAM_API_FULL_TOKEN|startUpstreamStream/);
});

test("Invite link is ephemeral, origin restricted and never stored server-side", () => {
  assert.match(assistant, /useState\("")/);
  assert.match(assistant, /studio\\\.upstream\\\.so\\\/join/);
  assert.match(assistant, /navigator\.clipboard\.writeText/);
  assert.match(assistant, /n'est pas enregistré dans Pilotoki/);
  assert.doesNotMatch(assistant, /localStorage|sessionStorage|supabase|fetch\(/);
  assert.match(page, /settings\.canConnectGoogle \? \(upstreamStreams \?\? \[\]\) : \[\]/);
});
