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
  assert.match(page, /broadcast=\{video\}/);
  assert.match(page, /Options avancées \\(ancienne régie\\)/);
  assert.match(page, /Masquer les options avancées/);
  assert.match(page, /Diffuser la partie/);
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
  assert.match(page, /streams=\{\s*settings\.canConnectGoogle/);
  assert.match(page, /upstreamStreams \?\? \[\]/);
});

test("One confirmed action starts Upstream and publishes after verifying YouTube ingest", () => {
  assert.match(assistant, /Diffuser cette partie/);
  assert.match(assistant, /const launchPartie = async/);
  assert.match(assistant, /!confirmedControl/);
  assert.match(assistant, /controlStatus\.canStart/);
  assert.match(assistant, /controlUpstream\(broadcast\.id, "start"\)/);
  assert.match(assistant, /getUpstreamControlStatus\(broadcast\.id\)/);
  assert.match(assistant, /status\.streamStatus === "active"/);
  assert.match(assistant, /publishYoutubeLive\(/);
  assert.match(assistant, /setAwaitingYoutubePublication\(true\)/);
  assert.match(assistant, /refreshBroadcastStatuses\(/);
  assert.match(assistant, /video\.status === "live"/);
});
