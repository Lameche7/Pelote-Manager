import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("le Mode TV PCL conserve une adresse canonique stable", async () => {
  const [settingsPage, service, vercel] = await Promise.all([
    read("../src/features/admin/settings/pages/AdminTvSettingsPage.tsx"),
    read("../src/features/admin/settings/services/adminTvSettingsService.ts"),
    read("../vercel.json"),
  ]);

  assert.match(
    settingsPage,
    /const PUBLIC_TV_URL = "https:\/\/app\.pelotemanager\.fr\/tv\/pcl"/,
  );
  assert.doesNotMatch(settingsPage, /Régénérer le lien/);
  assert.doesNotMatch(service, /admin_rotate_tv_token/);
  assert.match(vercel, /"source": "\/tv\/pcl"/);
  assert.match(vercel, /08008b4d-9825-487d-a156-8e69f7b8aaca/);
});
