import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shell = await readFile(
  "src/features/admin/components/AdminShell.tsx",
  "utf8",
);
const styles = await readFile(
  "src/features/admin/components/AdminShell.css",
  "utf8",
);

test("l administration mobile utilise un menu compact au lieu d une barre horizontale", () => {
  assert.match(shell, /admin-shell__mobile-bar/);
  assert.match(shell, /admin-shell__menu-toggle/);
  assert.match(shell, /aria-controls="admin-navigation"/);
  assert.match(shell, /aria-expanded=\{mobileNavigationOpen\}/);
  assert.match(styles, /\.admin-shell__sidebar--open\s*\{\s*display: block;/);
  assert.match(styles, /\.admin-shell__sidebar nav\s*\{[^}]*overflow-y: auto;/s);
  assert.doesNotMatch(styles, /\.admin-shell__sidebar nav\s*\{[^}]*overflow-x: auto;/s);
});

test("le menu mobile affiche la section courante et se referme après navigation", () => {
  assert.match(shell, /const currentLabel =/);
  assert.match(shell, /useLocation\(\)/);
  assert.match(shell, /setMobileNavigationOpen\(false\)/);
  assert.match(shell, /<strong>\{currentLabel\}<\/strong>/);
  assert.match(shell, /onClick=\{\(\) => setMobileNavigationOpen\(false\)\}/);
});

test("les cibles tactiles et le contenu admin sont adaptés aux petits écrans", () => {
  assert.match(styles, /min-height: 2\.65rem/);
  assert.match(styles, /\.admin-shell__content\s*\{\s*padding: 0\.85rem 0\.75rem 1\.5rem;/);
  assert.match(styles, /touch-action: manipulation/);
  assert.match(styles, /@media \(max-width: 24rem\)/);
});
