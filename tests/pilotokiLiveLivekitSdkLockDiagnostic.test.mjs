import { test } from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
test("TEMPORARY derive pinned LiveKit SDK dependency lock", () => {
  let lock = readFileSync("package-lock.json", "utf8");
  if (!JSON.parse(lock).packages["node_modules/livekit-client"]) {
    execFileSync("npm", [
      "install",
      "--package-lock-only",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "livekit-client@2.24.1",
    ], { timeout: 90000, stdio: "pipe" });
    lock = readFileSync("package-lock.json", "utf8");
  }
  if (!JSON.parse(lock).packages["node_modules/livekit-client"])
    throw new Error("LiveKit SDK lock not generated");
  console.log("LIVEKIT_LOCK_START:" + Buffer.from(lock).toString("base64") + ":LIVEKIT_LOCK_END");
});
