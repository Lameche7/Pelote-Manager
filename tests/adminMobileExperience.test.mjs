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
const mobileStyles = await readFile(
  "src/features/admin/components/AdminMobileExperience.css",
  "utf8",
);

const sidebarOpen = /\.admin-shell__sidebar--open\s*\{\s*display: block;/;
const verticalNavigation =
  /\.admin-shell__sidebar nav\s*\{[^}]*overflow-y: auto;/s;
const horizontalNavigation =
  /\.admin-shell__sidebar nav\s*\{[^}]*overflow-x: auto;/s;
const mobileDashboard =
  /\.admin-shell \.admin-dashboard__metrics\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/;
const mobileTournaments =
  /\.admin-shell \.tournaments-grid\s*\{\s*grid-template-columns: 1fr/;

test("menu administration compact", () => {
  assert.match(shell, /admin-shell__mobile-bar/);
  assert.match(shell, /admin-shell__menu-toggle/);
  assert.match(shell, /aria-controls="admin-navigation"/);
  assert.match(shell, /aria-expanded=\{mobileNavigationOpen\}/);
  assert.match(styles, sidebarOpen);
  assert.match(styles, verticalNavigation);
  assert.doesNotMatch(styles, horizontalNavigation);
});

test("section courante et fermeture du menu", () => {
  assert.match(shell, /const currentLabel =/);
  assert.match(shell, /useLocation\(\)/);
  assert.match(shell, /setMobileNavigationOpen\(false\)/);
  assert.match(shell, /<strong>\{currentLabel\}<\/strong>/);
  assert.match(shell, /onClick=\{\(\) => setMobileNavigationOpen\(false\)\}/);
});

test("cibles tactiles adaptées", () => {
  assert.match(styles, /min-height: 2\.65rem/);
  assert.match(styles, /padding: 0\.85rem 0\.75rem 1\.5rem/);
  assert.match(styles, /touch-action: manipulation/);
  assert.match(styles, /@media \(max-width: 24rem\)/);
});

test("écrans admin compacts sur téléphone", () => {
  assert.match(mobileStyles, mobileDashboard);
  assert.match(mobileStyles, mobileTournaments);
  assert.match(mobileStyles, /\.admin-shell \.member-dialog/);
  assert.match(mobileStyles, /max-height: calc\(100dvh - 1\.2rem\)/);
});
