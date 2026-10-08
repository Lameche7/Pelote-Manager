import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/features/admin/reservations/services/slotExchangePreview.ts", import.meta.url), "utf8");
test("preview module is read-only and requires backend validation", () => {
  assert.match(source, /export function previewSwap/);
  assert.match(source, /firstDuration !== secondDuration/);
  assert.match(source, /first\.id === second\.id/);
  assert.doesNotMatch(source, /supabase|\.rpc\(|\.update\(/);
});
