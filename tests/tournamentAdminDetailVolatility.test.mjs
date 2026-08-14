import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("le détail admin peut synchroniser l'état des inscriptions", async () => {
  const migration = await read(
    "../supabase/migrations/20260814173000_fix_admin_tournament_detail_volatility.sql",
  );

  assert.match(
    migration,
    /alter function public\.admin_get_tournament_with_finals_minimum\(uuid\) volatile;/,
  );
});
