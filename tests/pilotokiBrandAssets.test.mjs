import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("PILOTOKI utilise les assets de marque validés dans l'application et la PWA", () => {
  const assets = [
    "public/branding/pilotoki-wordmark.png",
    "public/branding/pilotoki-mark.png",
    "public/branding/pilotoki-app-icon.png",
    "public/branding/pilotoki-branding.css",
  ];

  for (const asset of assets) {
    assert.equal(existsSync(asset), true, `${asset} doit exister`);
  }

  const html = read("index.html");
  assert.match(html, /branding\/pilotoki-app-icon\.png\?v=20260912-home2/);
  assert.match(html, /apple-touch-icon/);
  assert.match(html, /sizes="180x180"/);
  assert.match(html, /manifest\.webmanifest\?v=20260912-home2/);
  assert.match(html, /pilotoki-branding\.css/);
  assert.match(html, /#0b1e2b/);

  const manifest = JSON.parse(read("public/manifest.webmanifest"));
  assert.equal(manifest.name, "PILOTOKI");
  assert.equal(manifest.theme_color, "#0b1e2b");
  assert.deepEqual(
    manifest.icons.map((icon) => icon.src),
    ["/branding/pilotoki-app-icon.png?v=20260912-home2"],
  );

  const brandingCss = read("public/branding/pilotoki-branding.css");
  assert.match(brandingCss, /pilotoki-wordmark\.png/);
  assert.match(brandingCss, /pilotoki-app-icon\.png/);
  assert.doesNotMatch(brandingCss, /data:image\/png;base64/);
});
