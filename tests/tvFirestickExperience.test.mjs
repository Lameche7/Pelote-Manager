import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("le lien public du Mode TV reste sur le domaine officiel depuis l’admin", async () => {
  const [domains, settingsPage] = await Promise.all([
    read("../src/shared/config/domains.ts"),
    read("../src/features/admin/settings/pages/AdminTvSettingsPage.tsx"),
  ]);

  assert.match(domains, /ADMIN_TV_SETTINGS_PATH = "\/admin\/parametres"/);
  assert.match(domains, /isAdminTvSettingsPath\(window\.location\.pathname\)/);
  assert.match(domains, /return `https:\/\/\$\{APP_HOST\}`/);
  assert.match(
    settingsPage,
    /`\$\{currentApplicationOrigin\(\)\}\$\{ROUTES\.tv\}\/\$\{settings\.publicToken\}`/,
  );
});

test("le Mode TV propose un plein écran déclenché par l’utilisateur avec repli WebKit", async () => {
  const [main, fullscreen] = await Promise.all([
    read("../src/main.tsx"),
    read("../src/features/tv/tvFullscreenPrompt.ts"),
  ]);

  assert.match(main, /setupTvFullscreenPrompt\(\)/);
  assert.match(fullscreen, /TV_PATH_PATTERN = \/\^\\\/tv\\\/\[\^\/\]\+\\\/?\$\//);
  assert.match(fullscreen, /target\.requestFullscreen/);
  assert.match(fullscreen, /target\.webkitRequestFullscreen/);
  assert.match(fullscreen, /⛶ Plein écran/);
  assert.match(fullscreen, /fullscreenchange/);
  assert.match(fullscreen, /webkitfullscreenchange/);
});
