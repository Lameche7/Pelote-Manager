import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("la vue du jour réutilise la projection publique des prochains évènements", async () => {
  const page = await read("../src/features/tv/pages/TvDisplayPage.tsx");

  assert.match(page, /publicEventService\.listUpcomingEvents\(\)/);
  assert.match(page, /const MAX_TV_EVENTS = 3/);
  assert.match(page, /Prochains évènements/);
  assert.match(page, /eventDateFormatter/);
  assert.match(page, /event\.resourceNames/);
});

test("les deux QR codes encodent seulement des URL publiques", async () => {
  const page = await read("../src/features/tv/pages/TvDisplayPage.tsx");

  assert.match(page, /const QR_ENDPOINT = "https:\/\/quickchart\.io\/qr"/);
  assert.match(page, /encodeURIComponent\(value\)/);
  assert.match(page, /const appUrl = window\.location\.origin/);
  assert.match(
    page,
    /https:\/\/www\.helloasso\.com\/associations\/pelotaris-club-lourdais\/boutiques\/dotations-2026/,
  );
  assert.match(page, /referrerPolicy="no-referrer"/);
  assert.doesNotMatch(page, /buildQrImageUrl\(token\)/);
});

test("l'écran boutique est prêt pour les dotations et les partenaires", async () => {
  const [page, styles] = await Promise.all([
    read("../src/features/tv/pages/TvDisplayPage.tsx"),
    read("../src/features/tv/pages/TvPromotionView.css"),
  ]);

  assert.match(page, /Dotations 2026/);
  assert.match(page, /Ouvrir la boutique/);
  assert.match(page, /Textile club/);
  assert.match(page, /Équipements/);
  assert.match(page, /Idées cadeaux/);
  assert.match(page, /Merci à ceux qui font vivre le club/);
  assert.match(styles, /tv-display__shop-panel/);
  assert.match(styles, /tv-display__partners-panel/);
  assert.match(styles, /tv-display__qr-card/);
});
