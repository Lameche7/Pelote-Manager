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
import {
  buildImportValidationPayload,
  importSucceeded,
  canGoToNextPage,
} from "../.test-dist/src/features/admin/members/domain/importWorkflow.js";
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

test("permet de forcer séparateur et encodage", () => {
  const csv = "Licence,Nom\n001,Durand";
  assert.equal(parseCsv(csv, ",")[1][1], "Durand");
  const cp = new Uint8Array([0x4a, 0x6f, 0x73, 0xe9]).buffer;
  assert.equal(decodeCsv(cp, "windows-1252").text, "José");
});
test("applique un mapping manuel et révèle les colonnes obligatoires absentes", () => {
  const mapped = mapMemberRow(["Durand", "001"], {
    last_name: 0,
    licence_number: 1,
  });
  assert.equal(mapped.licenceNumber, "001");
  assert.equal(mapped.birthDate, null);
  assert.equal(mapped.gender, null);
});
test("classe les membres existants, externes, inactifs et sensibles", () => {
  const base = {
    licenceNumber: "001",
    firstName: "Alice",
    lastName: "Durand",
    birthDate: "2000-01-01",
    gender: "female",
    email: "",
    phone: "",
    ranking: "",
  };
  const existing = {
    ...base,
    id: "member",
    clubId: "club",
    isActive: true,
    updatedAt: "v1",
  };
  assert.equal(
    buildImportPreview([base], [existing], "club")[0].action,
    "unchanged",
  );
  assert.equal(
    buildImportPreview([base], [{ ...existing, clubId: "other" }], "club")[0]
      .action,
    "other_club",
  );
  assert.equal(
    buildImportPreview([base], [{ ...existing, isActive: false }], "club")[0]
      .action,
    "inactive",
  );
  assert.equal(
    buildImportPreview(
      [{ ...base, birthDate: "2001-01-01" }],
      [existing],
      "club",
    )[0].action,
    "sensitive_warning",
  );
});
test("bloque une identité connue sous une autre licence", () => {
  const row = {
    licenceNumber: "002",
    firstName: "Alice",
    lastName: "Durand",
    birthDate: "2000-01-01",
    gender: "female",
    email: "",
    phone: "",
    ranking: "",
  };
  const existing = {
    ...row,
    licenceNumber: "001",
    id: "member",
    clubId: "club",
    isActive: true,
    updatedAt: "v1",
  };
  assert.equal(
    buildImportPreview([row], [existing], "club")[0].action,
    "identity_conflict",
  );
});

test("construit les décisions Supabase et interprète succès, échec et pagination", () => {
  const row = {
    lineNumber: 2,
    data: {
      licenceNumber: "001",
      firstName: "A",
      lastName: "B",
      birthDate: "2000-01-01",
      gender: "male",
      email: "",
      phone: "",
      ranking: "",
    },
    action: "inactive",
    errors: [],
    warnings: [],
    ignored: false,
    confirmedSensitive: true,
    confirmDistinctIdentity: false,
    distinctIdentityConflict: false,
    reactivate: true,
  };
  const payload = buildImportValidationPayload([row], [[], ["001"]]);
  assert.deepEqual(payload[0].decision, {
    ignored: false,
    confirmedSensitive: true,
    reactivate: true,
    confirmDistinctIdentity: false,
  });
  assert.equal(
    importSucceeded({
      status: "completed",
      created: 1,
      updated: 0,
      reactivated: 0,
      unchanged: 0,
      ignored: 0,
    }),
    true,
  );
  assert.equal(
    importSucceeded({
      status: "failed",
      error: "boom",
      created: 0,
      updated: 0,
      reactivated: 0,
      unchanged: 0,
      ignored: 0,
    }),
    false,
  );
  assert.equal(canGoToNextPage(2, 25, 51), true);
  assert.equal(canGoToNextPage(3, 25, 51), false);
});

test("les appels RPC membres sont déclarés et sans contournement de types", async () => {
  const { readFile } = await import("node:fs/promises");
  const service = await readFile(
    new URL(
      "../src/features/admin/members/services/memberAdminService.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const database = await readFile(
    new URL("../src/infrastructure/supabase/database.ts", import.meta.url),
    "utf8",
  );
  for (const rpc of [
    "admin_get_member",
    "admin_update_member",
    "admin_correct_member_licence",
    "admin_find_member_import_matches",
    "admin_create_member_import",
    "admin_validate_member_import",
    "admin_execute_member_import",
    "admin_get_member_import",
  ]) {
    assert.match(service, new RegExp(`supabase\\.rpc\\("${rpc}"`));
    assert.match(database, new RegExp(rpc));
  }
  assert.doesNotMatch(service, /as never|as any/);
});
test("tournaments.manage ouvre seulement la recherche et le détail", async () => {
  const { readFile } = await import("node:fs/promises");
  const router = await readFile(
    new URL("../src/app/router.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    router,
    /membres\/recherche-globale[\s\S]*ADMIN_PERMISSIONS\.members,[\s\S]*ADMIN_PERMISSIONS\.tournaments/,
  );
  assert.match(
    router,
    /membres\/importer[^\n]*permitted\(ADMIN_PERMISSIONS\.members/,
  );
});

test("initialise et transmet une confirmation d’identité distincte indépendante", () => {
  const data = {
    licenceNumber: "NEW",
    firstName: "Alice",
    lastName: "Durand",
    birthDate: "2000-01-01",
    gender: "female",
    email: "",
    phone: "",
    ranking: "",
  };
  const existing = {
    ...data,
    licenceNumber: "OLD",
    id: "member",
    clubId: "club",
    isActive: true,
    updatedAt: "v1",
  };
  const preview = buildImportPreview([data], [existing], "club")[0];
  assert.equal(preview.confirmDistinctIdentity, false);
  assert.equal(preview.distinctIdentityConflict, true);
  const decided = {
    ...preview,
    confirmDistinctIdentity: true,
    confirmedSensitive: false,
    reactivate: false,
    ignored: false,
  };
  const decision = buildImportValidationPayload([decided], [[], ["NEW"]])[0]
    .decision;
  assert.deepEqual(decision, {
    ignored: false,
    confirmedSensitive: false,
    reactivate: false,
    confirmDistinctIdentity: true,
  });
});
test("la mutation saisonnière appelle la RPC et invalide la fiche", async () => {
  const { readFile } = await import("node:fs/promises");
  const hooks = await readFile(
    new URL(
      "../src/features/admin/members/hooks/useAdminMembers.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const detail = await readFile(
    new URL(
      "../src/features/admin/members/pages/MemberDetailPage.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    hooks,
    /useUpdateMemberSeason[\s\S]*updateSeason[\s\S]*invalidateQueries/,
  );
  assert.match(detail, /Modifier la saison/);
  assert.match(detail, /MemberSeasonDialog/);
});
test("le détail d’import accepte les actions saisonnières réelles", async () => {
  const { readFile } = await import("node:fs/promises");
  const types = await readFile(
    new URL("../src/features/admin/members/types.ts", import.meta.url),
    "utf8",
  );
  assert.match(types, /"season_created"/);
  assert.match(types, /"season_updated"/);
});

test("affiche la confirmation d’identité distincte sans la confondre avec les autres décisions", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(
    new URL(
      "../src/features/admin/members/pages/MemberImportPage.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(page, /Je confirme qu’il s’agit d’une autre personne/);
  assert.match(page, /confirmDistinctIdentity: e\.target\.checked/);
});
test("la boîte de saison affiche les erreurs PostgreSQL et les confirmations requises", async () => {
  const { readFile } = await import("node:fs/promises");
  const dialog = await readFile(
    new URL(
      "../src/features/admin/members/components/MemberSeasonDialog.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(dialog, /Motif/);
  assert.match(dialog, /role="alert"/);
  assert.match(dialog, /isLicensed !== season\.isLicensed/);
});
