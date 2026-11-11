import { test } from "node:test";
import { execFileSync } from "node:child_process";
test("dump prettier output for bracket", () => {
  const output = execFileSync("./node_modules/.bin/prettier", ["src/features/user-space/championships/components/ChampionshipFinalBracket.tsx"], { encoding: "utf8" });
  console.log("PRETTIER_OUTPUT_BEGIN");
  console.log(Buffer.from(output).toString("base64"));
  console.log("PRETTIER_OUTPUT_END");
});
