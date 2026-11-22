import { test } from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
test("TEMP: print canonical Prettier Egress test", () => {
  const filename = "tests/pilotokiLiveEgress.test.mjs";
  execFileSync("./node_modules/.bin/prettier", ["--write", filename], { stdio: "pipe" });
  console.log("CANON_EGRESS_START:" + Buffer.from(readFileSync(filename)).toString("base64") + ":CANON_EGRESS_END");
});
