import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("le Mode TV PCL conserve réellement l’adresse canonique /tv/pcl", async () => {
  const [settingsPage, service, vercel, publicLink, main] = await Promise.all([
    read("../src/features/admin/settings/pages/AdminTvSettingsPage.tsx"),
    read("../src/features/admin/settings/services/adminTvSettingsService.ts"),
    read("../vercel.json"),
    read("../src/features/tv/tvPublicLink.ts"),
    read("../src/main.tsx"),
  ]);

  assert.match(
    settingsPage,
    /const PUBLIC_TV_URL = "https:\/\/app\.pelotemanager\.fr\/tv\/pcl"/,
  );
  assert.doesNotMatch(settingsPage, /Régénérer le lien/);
  assert.doesNotMatch(service, /admin_rotate_tv_token/);

  assert.doesNotMatch(
    vercel,
    /"source": "\/tv\/pcl"[\s\S]*08008b4d-9825-487d-a156-8e69f7b8aaca/,
  );
  assert.match(publicLink, /export const PCL_TV_ALIAS = "pcl"/);
  assert.match(
    publicLink,
    /export const PCL_TV_TOKEN = "08008b4d-9825-487d-a156-8e69f7b8aaca"/,
  );
  assert.match(publicLink, /preparePclTvCanonicalUrl/);
  assert.match(publicLink, /window\.history\.replaceState/);
  assert.match(main, /const restorePclTvCanonicalUrl = preparePclTvCanonicalUrl\(\)/);
  assert.match(main, /flushSync/);
  assert.match(main, /restorePclTvCanonicalUrl\(\)/);
});
