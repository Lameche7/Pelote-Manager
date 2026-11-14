import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(
  new URL("../src/shared/config/domains.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const {
  resolveEntryClubSlug,
  resolvePlayerHomeClub,
  publicClubQuery,
  publicClubConfirmationRedirect,
} = await import(
  "data:text/javascript;charset=utf-8," + encodeURIComponent(compiled)
);

const verified = [
  { hostname: "lourdes.pelotemanager.fr", clubSlug: "pelotaris-club-lourdais" },
  { hostname: "morlaas.pelotemanager.fr", clubSlug: "pelotari-club-morlaas" },
];

test("le domaine public doit figurer dans le catalogue vérifié", () => {
  assert.equal(
    resolveEntryClubSlug("morlaas.pelotemanager.fr", verified),
    "pelotari-club-morlaas",
  );
  assert.equal(
    resolveEntryClubSlug("MORLAAS.PELOTEMANAGER.FR.", verified),
    "pelotari-club-morlaas",
  );
  assert.equal(resolveEntryClubSlug("inconnu.pelotemanager.fr", verified), null);
  assert.equal(
    resolveEntryClubSlug("morlaas.pelotemanager.fr.attacker.test", verified),
    null,
  );
});

test("les hôtes techniques ne deviennent jamais un club", () => {
  for (const host of [
    "localhost",
    "app.pelotemanager.fr",
    "www.pelotemanager.fr",
    "pelotemanager.fr",
    "pilotoki.vercel.app",
    "morlaas.pelotemanager.fr:443",
  ]) {
    assert.equal(resolveEntryClubSlug(host, verified), null);
  }
});

test("un domaine ambigu ou un slug invalide ne résout aucun club", () => {
  assert.equal(
    resolveEntryClubSlug("morlaas.pelotemanager.fr", [
      ...verified,
      verified[1],
    ]),
    null,
  );
  assert.equal(
    resolveEntryClubSlug("bad.pelotemanager.fr", [
      { hostname: "bad.pelotemanager.fr", clubSlug: "../lourdes" },
    ]),
    null,
  );
});

test("le favori prime sur la licence vérifiée puis sur le lien d'entrée", () => {
  assert.equal(resolvePlayerHomeClub("morlaas", null, null), "morlaas");
  assert.equal(resolvePlayerHomeClub("morlaas", "lourdes", null), "lourdes");
  assert.equal(
    resolvePlayerHomeClub("morlaas", "lourdes", "morlaas"),
    "morlaas",
  );
  assert.equal(resolvePlayerHomeClub(null, null, null), null);
});

test("les liens publics n'accordent aucun droit et rejettent les slugs invalides", () => {
  assert.equal(
    publicClubQuery("pelotari-club-morlaas"),
    "?club=pelotari-club-morlaas",
  );
  assert.equal(publicClubQuery("../admin"), "");
  assert.equal(publicClubQuery(""), "");
  assert.equal(
    publicClubConfirmationRedirect(
      "https://pilotoki.example/",
      "pelotari-club-morlaas",
    ),
    "https://pilotoki.example/?club=pelotari-club-morlaas",
  );
  assert.equal(
    publicClubConfirmationRedirect("https://pilotoki.example", "../admin"),
    "https://pilotoki.example/",
  );
});
