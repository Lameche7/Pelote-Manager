import { test } from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

test("temporary CLI formatting outputs for LiveKit Egress files", () => {
  const paths = [
    "api/_live-livekit-egress.mjs",
    "api/live-youtube-ingest.mjs",
    "src/features/admin/live/pages/PilotokiLiveLivekitCameraPage.tsx",
    "tests/pilotokiLiveEgress.test.mjs",
  ];
  for (const file of paths) {
    execFileSync("./node_modules/.bin/prettier", ["--write", file], { stdio: "pipe" });
    console.log("EGRESS_FMT_START:" + file + ":" + Buffer.from(readFileSync(file)).toString("base64") + ":EGRESS_FMT_END");
  }
});
