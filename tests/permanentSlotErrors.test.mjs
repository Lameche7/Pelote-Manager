import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("les erreurs métier des créneaux permanents sont rendues compréhensibles", async () => {
  const source = await read(
    "../src/infrastructure/supabase/errorMessages.ts",
  );

  assert.match(source, /paramètres du créneau permanent invalides/);
  assert.match(source, /terrain sélectionné n’est pas disponible/);
  assert.match(source, /titulaire principal doit posséder un compte PILOTOKI/);
  assert.match(source, /gestionnaires sélectionnés ne possède pas de compte PILOTOKI/);
  assert.match(source, /doit durer \$\{duration\} minutes/);
  assert.match(source, /terrain est déjà occupé le \$\{conflictDate\}/);
});
