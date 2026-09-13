import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("la télécommande permet de passer à l'écran précédent ou suivant", async () => {
  const [page, navigation] = await Promise.all([
    read("../src/features/tv/pages/TvDisplayPage.tsx"),
    read("../src/features/tv/components/TvRemoteNavigation.tsx"),
  ]);

  assert.match(page, /TvRemoteNavigation/);
  assert.match(page, /previousTvView/);
  assert.match(page, /nextTvView/);
  assert.match(navigation, /ArrowLeft/);
  assert.match(navigation, /ArrowRight/);
  assert.match(navigation, /Écran précédent/);
  assert.match(navigation, /Écran suivant/);
});

test("les commandes disparaissent après inactivité", async () => {
  const [navigation, styles] = await Promise.all([
    read("../src/features/tv/components/TvRemoteNavigation.tsx"),
    read("../src/features/tv/components/TvRemoteNavigation.css"),
  ]);

  assert.match(navigation, /HIDE_DELAY_MS = 3_000/);
  assert.match(navigation, /setIsVisible\(false\)/);
  assert.match(navigation, /pointermove/);
  assert.match(styles, /opacity: 0/);
  assert.match(styles, /tv-remote-navigation--visible/);
});

test("une navigation manuelle redémarre la temporisation automatique", async () => {
  const page = await read("../src/features/tv/pages/TvDisplayPage.tsx");

  assert.match(page, /window\.setTimeout/);
  assert.match(page, /display\.viewDurationSeconds \* 1_000/);
  assert.match(
    page,
    /\[activeView, display\?\.status, display\?\.viewDurationSeconds, viewOrder\]/,
  );
});
