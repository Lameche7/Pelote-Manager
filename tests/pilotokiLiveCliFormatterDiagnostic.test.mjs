import { test } from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
test("temporary CLI formatter output", () => {
  const file = "src/features/admin/live/pages/PilotokiLiveLivekitCameraPage.tsx";
  execFileSync("./node_modules/.bin/prettier", ["--write", file], {
    stdio: "pipe",
  });
  console.log("CLI_FORMAT_START:" + Buffer.from(readFileSync(file)).toString("base64") + ":CLI_FORMAT_END");
});
