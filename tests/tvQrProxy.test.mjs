import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../api/tv-qr.mjs", import.meta.url),
  "utf8",
);

test("le proxy QR TV reste un endpoint GET borné et cacheable", () => {
  assert.match(source, /request\.method !== "GET"/);
  assert.match(source, /const MAX_QR_TEXT_LENGTH = 2048/);
  assert.match(source, /contentType\.toLowerCase\(\)\.includes\("image\/png"\)/);
  assert.match(source, /s-maxage=604800/);
});
