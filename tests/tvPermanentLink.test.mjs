import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("le Mode TV PCL accepte directement /tv/pcl sans réécriture bootstrap", async () => {
  const [settingsPage, service, vercel, publicLink, main, displayPage] =
    await Promise.all([
      read("../src/features/admin/settings/pages/AdminTvSettingsPage.tsx"),
      read("../src/features/admin/settings/services/adminTvSettingsService.ts"),
      read("../vercel.json"),
      read("../src/features/tv/tvPublicLink.ts"),
      read("../src/main.tsx"),
      read("../src/features/tv/pages/TvDisplayPage.tsx"),
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
  assert.match(publicLink, /export const resolvePublicTvToken/);
  assert.match(publicLink, /export const isPublicTvIdentifier/);
  assert.match(publicLink, /export const canonicalizePclTvUrl/);

  assert.match(displayPage, /const tokenIsValid = isPublicTvIdentifier\(token\)/);
  assert.match(displayPage, /const resolvedToken = resolvePublicTvToken\(token\)/);
  assert.match(displayPage, /tvDisplayService\.getDisplay\(resolvedToken\)/);
  assert.match(displayPage, /tvMediaService\.list\(resolvedToken\)/);
  assert.match(displayPage, /canonicalizePclTvUrl\(token\)/);

  assert.doesNotMatch(displayPage, /tokenPattern\.test\(token\)/);
  assert.doesNotMatch(main, /preparePclTvCanonicalUrl/);
  assert.doesNotMatch(main, /flushSync/);
});
