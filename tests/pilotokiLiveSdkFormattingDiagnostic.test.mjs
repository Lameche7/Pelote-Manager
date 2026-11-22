import { test } from "node:test";
import { readFileSync } from "node:fs";
test("temporary print formatted mobile LiveKit SDK page", async () => {
  const prettier = await import("prettier");
  const path = "src/features/admin/live/pages/PilotokiLiveLivekitCameraPage.tsx";
  const config = await prettier.resolveConfig(path);
  const formatted = await prettier.format(readFileSync(path, "utf8"), {
    ...config,
    filepath: path,
  });
  console.log("MOBILE_FORMAT_START:" + Buffer.from(formatted).toString("base64") + ":MOBILE_FORMAT_END");
});
