import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { format, resolveConfig } from "prettier";

test("temporary formatting diagnostics", async () => {
  const files = [
    "src/features/admin/tournaments/components/AdminTournamentFinalFullPlanning.tsx",
    "tests/finalsDynamicPlanningOnlyKnownOpponents.test.mjs",
  ];
  for (const path of files) {
    const original = readFileSync(path, "utf8");
    const formatted = await format(original, {
      ...(await resolveConfig(path)),
      filepath: path,
    });
    if (formatted === original) continue;
    const dir = mkdtempSync(join(tmpdir(), "format-check-"));
    const target = join(dir, "formatted.txt");
    writeFileSync(target, formatted, "utf8");
    try {
      execFileSync("diff", ["-u", path, target], {
        encoding: "utf8",
      });
    } catch (error) {
      const output = error.stdout ?? "";
      console.log("PRETTIER DIFF FOR", path, String(output).slice(0, 15000));
    }
  }
});
