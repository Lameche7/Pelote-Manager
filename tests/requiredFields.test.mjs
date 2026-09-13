import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [component, styles, main] = await Promise.all([
  read("../src/shared/components/forms/RequiredField.tsx"),
  read("../src/styles/forms.css"),
  read("../src/main.tsx"),
]);

test("fournit une étoile et une légende communes pour les champs obligatoires", () => {
  assert.match(component, /RequiredFieldMark/);
  assert.match(component, /RequiredFieldsNotice/);
  assert.match(component, /Champ obligatoire/);
  assert.match(component, /Champs obligatoires/);
  assert.match(component, /aria-hidden="true"/);
});

test("met visuellement en évidence les contrôles required et invalides", () => {
  assert.match(styles, /\[required\]/);
  assert.match(styles, /--form-required/);
  assert.match(styles, /\[aria-invalid="true"\]/);
  assert.match(styles, /\.field-error/);
});

test("charge les styles de formulaire au démarrage de l'application", () => {
  assert.match(main, /\.\/styles\/forms\.css/);
});
