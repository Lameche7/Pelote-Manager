import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("le Mode TV est verrouillé dans le viewport sans scroll", async () => {
  const css = await read("../src/features/tv/pages/TvDisplayPage.css");

  assert.match(css, /\.tv-display\s*\{[\s\S]*position:\s*fixed/);
  assert.match(css, /inset:\s*0/);
  assert.match(css, /overflow:\s*hidden/);
  assert.match(css, /flex-direction:\s*column/);
});

test("la vue hebdomadaire conserve toujours les sept jours sur une ligne", async () => {
  const css = await read("../src/features/tv/pages/TvWeeklyView.css");

  assert.match(
    css,
    /\.tv-display__week-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(7,/,
  );
  assert.doesNotMatch(css, /@media\s*\(max-width:\s*72rem\)/);
  assert.doesNotMatch(css, /grid-template-columns:\s*repeat\(4,/);
});

test("les partenaires restent prioritaires sur la boutique", async () => {
  const promotion = await read(
    "../src/features/tv/pages/TvPromotionView.css",
  );
  const gallery = await read("../src/features/tv/pages/TvMediaGallery.css");

  assert.match(
    promotion,
    /\.tv-display__promotion-main\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 3fr\) minmax\(13rem, 1fr\)/,
  );
  assert.match(
    promotion,
    /\.tv-display__partners-panel\s*\{[\s\S]*order:\s*1/,
  );
  assert.match(
    promotion,
    /\.tv-display__shop-panel\s*\{[\s\S]*order:\s*2/,
  );
  assert.doesNotMatch(promotion, /@media\s*\(max-width:\s*72rem\)/);
  assert.match(
    gallery,
    /\.tv-display__partner-media\s*\{[\s\S]*grid-template-columns:\s*repeat\(4,/,
  );
});
