import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("l'écran TV récupère la palette du club au démarrage puis quotidiennement", async () => {
  const [page, style] = await Promise.all([
    read("../src/features/tv/pages/TvDisplayPage.tsx"),
    read("../src/features/tv/pages/TvDisplayPage.css"),
  ]);

  assert.match(page, /clubBrandingService\.getPublicBranding\(\)/);
  assert.match(page, /void loadBranding\(\)/);
  assert.match(page, /24 \* 60 \* 60 \* 1_000/);
  assert.match(page, /window\.clearInterval\(refresh\)/);
  assert.match(page, /"--tv-club-primary": branding\.primaryColor/);
  assert.match(style, /var\(--tv-club-primary/);
  assert.match(style, /\.tv-display__header/);
});

test("le ruban saisonnier est placé à droite du nom du club TV", async () => {
  const page = await read("../src/features/tv/pages/TvDisplayPage.tsx");
  assert.match(
    page,
    /now\.getFullYear\(\) === 2026 && now\.getMonth\(\) === 9/,
  );
  assert.match(page, /<h1>\{clubName\}<\/h1>[\s\S]*isOctoberRose/);
  assert.match(page, /\/branding\/octobre-rose-ribbon\.svg/);
});
