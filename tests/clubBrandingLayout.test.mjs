import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("la palette du club pilote le bandeau, le pied de page et les boutons", async () => {
  const [layout, styles] = await Promise.all([
    read("../src/app/layouts/MainLayout.tsx"),
    read("../src/app/layouts/MainLayout.css"),
  ]);

  assert.match(layout, /clubBrandingService\.getPublicBranding\(clubSlug\)/);
  assert.match(layout, /club-branding-updated/);
  assert.match(layout, /"--club-primary": branding\.primaryColor/);
  assert.match(layout, /"--club-secondary": branding\.secondaryColor/);
  assert.match(layout, /"--club-accent": branding\.accentColor/);
  assert.match(layout, /className="app-layout" style=\{layoutStyle\}/);
  assert.match(styles, /\.app-layout \.app-header/);
  assert.match(styles, /\.app-layout \.app-footer/);
  assert.match(styles, /\.app-layout \.button--primary/);
  assert.match(styles, /\.app-layout \.button--secondary/);
});
