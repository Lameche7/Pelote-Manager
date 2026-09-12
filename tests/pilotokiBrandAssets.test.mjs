import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("PILOTOKI utilise les assets de marque dans l'application et la PWA", () => {
  const assets = [
    "public/branding/pilotoki-wordmark.png",
    "public/branding/pilotoki-mark.png",
    "public/branding/pilotoki-branding.css",
    "public/pwa-icon-192.png",
    "public/pwa-icon-512.png",
    "public/pwa-icon-maskable-512.png",
    "public/pwa-icon.svg",
  ];

  for (const asset of assets) {
    assert.equal(existsSync(asset), true, `${asset} doit exister`);
  }

  const html = read("index.html");
  assert.match(html, /pwa-icon-192\.png/);
  assert.match(html, /pilotoki-branding\.css/);
  assert.match(html, /#0b1e2b/);

  const manifest = JSON.parse(read("public/manifest.webmanifest"));
  assert.equal(manifest.name, "PILOTOKI");
  assert.equal(manifest.theme_color, "#0b1e2b");
  assert.deepEqual(
    manifest.icons.map((icon) => icon.src),
    [
      "/pwa-icon-192.png",
      "/pwa-icon-512.png",
      "/pwa-icon-maskable-512.png",
    ],
  );

  const brandingCss = read("public/branding/pilotoki-branding.css");
  assert.match(brandingCss, /pilotoki-wordmark\.png/);
  assert.match(brandingCss, /pilotoki-mark\.png/);
});
