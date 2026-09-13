import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL(
    "../src/features/user-space/championships/pages/MyChampionshipsPage.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("signale les scores obligatoires de la saisie de résultat", () => {
  assert.match(source, /RequiredFieldMark/);
  assert.match(source, /RequiredFieldsNotice/);
  assert.match(
    source,
    /\{isSets \? "Nos manches" : "Nos points"\} <RequiredFieldMark \/>/,
  );
  assert.match(
    source,
    /\{isSets \? "Manches adverses" : "Points adverses"\} <RequiredFieldMark \/>/,
  );
  assert.match(source, /<RequiredFieldsNotice \/>/);
});

test("conserve le commentaire de résultat facultatif", () => {
  assert.match(source, /Commentaire facultatif/);
  assert.doesNotMatch(
    source,
    /Commentaire facultatif[^<]*<RequiredFieldMark \/>/,
  );
});
