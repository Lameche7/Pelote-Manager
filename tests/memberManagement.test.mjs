import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLicenceNumber,
  normalizeIdentity,
  parseMemberDate,
  normalizeGender,
  calculateMemberCategory,
} from "../.test-dist/src/features/admin/members/domain/memberRules.js";
import {
  autoMapColumns,
  decodeCsv,
  detectSeparator,
  findFileDuplicates,
  mapMemberRow,
  parseCsv,
} from "../.test-dist/src/features/admin/members/domain/csvImport.js";
import {
  buildImportPreview,
  mergeNonEmpty,
  summarizePreview,
} from "../.test-dist/src/features/admin/members/domain/importPreview.js";
test("normalise les licences sans perdre les zéros", () =>
  assert.equal(normalizeLicenceNumber(" ab 00123 "), "AB00123"));
test("normalise les identités", () =>
  assert.equal(normalizeIdentity(" D’Ár-cy "), "DARCY"));
test("dates et sexes français", () => {
  assert.equal(parseMemberDate("31/12/2000"), "2000-12-31");
  assert.equal(parseMemberDate("31-02-2000"), null);
  assert.equal(normalizeGender("Féminin"), "female");
  assert.equal(normalizeGender("Homme"), "male");
  assert.equal(normalizeGender("X"), null);
});
test("catégories aux limites", () => {
  assert.equal(calculateMemberCategory("2017-01-01", "2026-06-30"), "M10");
  assert.equal(calculateMemberCategory("2016-01-01", "2026-06-30"), "M12");
  assert.equal(
    calculateMemberCategory("1981-01-01", "2026-06-30"),
    "Vétéran A/B",
  );
  assert.equal(
    calculateMemberCategory("1971-01-01", "2026-06-30"),
    "Vétéran Senior",
  );
});
test("détecte séparateur, encodage et mapping", () => {
  const source =
    "Licence;Prénom;Nom;Date de naissance;Sexe\n001;Élodie;Durand;01/02/2000;F";
  assert.equal(detectSeparator(source), ";");
  const rows = parseCsv(source);
  const mapping = autoMapColumns(rows[0]);
  assert.deepEqual(mapMemberRow(rows[1], mapping), {
    licenceNumber: "001",
    firstName: "Élodie",
    lastName: "Durand",
    birthDate: "2000-02-01",
    gender: "female",
    email: "",
    phone: "",
    ranking: "",
  });
  const cp = new Uint8Array([0x4a, 0x6f, 0x73, 0xe9]).buffer;
  assert.equal(decodeCsv(cp).encoding, "windows-1252");
});
test("bloque tous les doublons internes", () => {
  const row = {
    licenceNumber: "001",
    firstName: "A",
    lastName: "B",
    birthDate: "2000-01-01",
    gender: "male",
    email: "",
    phone: "",
    ranking: "",
  };
  assert.deepEqual([...findFileDuplicates([row, row])], [0, 1]);
});
test("prévisualise les conflits et résume", () => {
  const row = {
    licenceNumber: "001",
    firstName: "A",
    lastName: "B",
    birthDate: "2000-01-01",
    gender: "male",
    email: "",
    phone: "",
    ranking: "",
  };
  const preview = buildImportPreview([row], [], "club");
  assert.equal(preview[0].action, "create");
  assert.equal(summarizePreview(preview).create, 1);
});
test("les cellules vides conservent les valeurs", () =>
  assert.deepEqual(
    mergeNonEmpty({ email: "a@b.fr", phone: "1" }, { email: "", phone: "2" }),
    { email: "a@b.fr", phone: "2" },
  ));
