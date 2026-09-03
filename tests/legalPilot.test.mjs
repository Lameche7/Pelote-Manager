import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("les documents du pilote sont accessibles depuis des routes publiques", async () => {
  const [routes, router] = await Promise.all([
    read("src/shared/config/routes.ts"),
    read("src/app/router.tsx"),
  ]);

  assert.match(routes, /legalNotice: "\/mentions-legales"/);
  assert.match(routes, /privacy: "\/confidentialite"/);
  assert.match(routes, /terms: "\/conditions-utilisation"/);
  assert.match(router, /<LegalNoticePage \/>/);
  assert.match(router, /<PrivacyPage \/>/);
  assert.match(router, /<TermsPage \/>/);
});

test("le pied de page rend les documents juridiques visibles", async () => {
  const layout = await read("src/app/layouts/MainLayout.tsx");

  assert.match(layout, /to=\{ROUTES\.legalNotice\}/);
  assert.match(layout, /to=\{ROUTES\.privacy\}/);
  assert.match(layout, /to=\{ROUTES\.terms\}/);
});

test("la politique explique le rattachement des participations importées", async () => {
  const legalPage = await read("src/features/legal/pages/LegalPage.tsx");

  assert.match(
    legalPage,
    /Pourquoi Pelote Manager peut déjà connaître votre inscription/,
  );
  assert.match(legalPage, /ne\s+constituent jamais une preuve d’identité/);
  assert.match(
    legalPage,
    /confirmez explicitement que la participation est la vôtre/,
  );
});
