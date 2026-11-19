import { readFileSync } from "node:fs";
import test from "node:test";
import prettier from "prettier";

test("render exact Prettier formatting for new Pilotoki Live files", async () => {
  const paths = [
    "api/_live-youtube-broadcast.mjs",
    "api/live-youtube-prepare.mjs",
    "src/features/admin/live/services/adminLiveSettingsService.ts",
    "src/features/admin/live/pages/AdminLiveSettingsPage.tsx",
    "src/features/admin/live/pages/AdminLiveSettingsPage.css",
    "tests/pilotokiLiveBroadcastPreparation.test.mjs",
  ];
  for (const path of paths) {
    const source = readFileSync(path, "utf8");
    const formatted = await prettier.format(source, { filepath: path });
    process.stdout.write("START_FMT:" + path + "\n");
    process.stdout.write(Buffer.from(formatted).toString("base64") + "\n");
    process.stdout.write("END_FMT:" + path + "\n");
  }
});
