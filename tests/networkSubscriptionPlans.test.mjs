import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = new URL(
  "../src/features/network/pages/NetworkPublicPages.tsx",
  import.meta.url,
);
const css = new URL(
  "../src/features/network/pages/NetworkDirectoryPage.css",
  import.meta.url,
);
const router = new URL("../src/app/router.tsx", import.meta.url);

test("la page d'abonnement présente les trois formules validées", async () => {
  const [source, styles, routes] = await Promise.all([
    readFile(page, "utf8"),
    readFile(css, "utf8"),
    readFile(router, "utf8"),
  ]);
  for (const name of ["Essentiel", "Club", "Premium"]) {
    assert.match(source, new RegExp('name: "' + name + '"'));
  }
  for (const price of ["9,90 €", "14,90 €", "19,90 €"]) {
    assert.ok(source.includes(price), "Tarif absent : " + price);
  }
  assert.match(source, /Notre formule recommandée/);
  assert.match(source, /Tournois : inscriptions, poules et programmation/);
  assert.match(source, /Championnats : calendrier et programmation/);
  assert.match(source, /Gestion des arbitres/);
  assert.match(source, /Mode TV pour les spectateurs/);
  assert.match(source, /paiements et l'essai gratuit ne sont pas encore/);
  assert.match(source, /to="\/reseau\/decouvrir"/);
  assert.doesNotMatch(source, /stripe\.com|\/checkout|\/paiement/);
  assert.match(styles, /network-pricing__cards/);
  assert.match(styles, /@media \(max-width: 850px\)/);
  assert.match(routes, /path: "\/reseau\/abonnement"/);
});
