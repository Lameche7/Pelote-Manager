import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [app, main, domains, marketing] = await Promise.all([
  read("src/app/App.tsx"),
  read("src/main.tsx"),
  read("src/shared/config/domains.ts"),
  read("src/features/marketing/pages/MarketingPage.tsx"),
]);

test("www affiche la vitrine tandis que l'application reste séparée", () => {
  assert.match(domains, /MARKETING_HOST = "www\.pelotemanager\.fr"/);
  assert.match(domains, /APP_HOST = "app\.pelotemanager\.fr"/);
  assert.match(app, /isMarketingHostname\(window\.location\.hostname\)/);
  assert.match(app, /return <MarketingPage \/>/);
});

test("la vitrine n'enregistre pas la PWA de l'application", () => {
  assert.match(
    main,
    /document\.querySelector\('link\[rel="manifest"\]'\)\?\.remove\(\)/,
  );
  assert.match(main, /registration\.unregister\(\)/);
});

test("la vitrine présente les modules principaux et renvoie vers l'application", () => {
  for (const label of [
    "Réservations",
    "Tournois",
    "Championnats",
    "Licenciés & club",
    "Communication",
    "Mode TV",
  ]) {
    assert.match(marketing, new RegExp(label.replace("&", "&")));
  }
  assert.match(marketing, /Ouvrir Pelote Manager/);
  assert.match(marketing, /applicationOrigin/);
});
