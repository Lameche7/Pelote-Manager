import { readFileSync } from "node:fs";
import test from "node:test";
import prettier from "prettier";
test("preview exact prettier camera studio output", async () => {
  const paths = [
    "src/features/admin/live/components/PilotokiLiveCameraStudio.tsx",
    "src/features/admin/live/components/PilotokiLiveCameraStudio.css",
    "tests/pilotokiLiveCameraStudio.test.mjs"
  ];
  for (const path of paths) {
    const source = readFileSync(path,"utf8");
    const formatted = await prettier.format(source, {filepath:path});
    process.stdout.write("START_FMT:"+path+"\n");
    process.stdout.write(Buffer.from(formatted).toString("base64")+"\n");
    process.stdout.write("END_FMT:"+path+"\n");
  }
});