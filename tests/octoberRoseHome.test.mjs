import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("le ruban Octobre Rose s'affiche sur l'accueil public uniquement en octobre 2026", async () => {
  const [home, css, ribbon] = await Promise.all([
    read("../src/features/home/pages/HomePage.tsx"),
    read("../src/features/home/pages/PremiumHomePage.css"),
    read("../public/branding/octobre-rose-ribbon.svg"),
  ]);

  assert.match(
    home,
    /today\.getFullYear\(\) === 2026 && today\.getMonth\(\) === 9/,
  );
  assert.match(home, /\{octoberRoseVisible && \(/);
  assert.match(home, /octobre-rose-ribbon\.svg/);
  assert.match(home, /Octobre Rose/);
  assert.match(css, /\.premium-home__october-rose/);
  assert.match(ribbon, /fill-rule="evenodd"/);
  assert.doesNotMatch(ribbon, /<rect/);
});

test("la moustache Movember s’affiche sur l’accueil en novembre", async () => {
  const [home, css, moustache] = await Promise.all([
    read("../src/features/home/pages/HomePage.tsx"),
    read("../src/features/home/pages/PremiumHomePage.css"),
    read("../public/branding/movember-moustache.svg"),
  ]);
  assert.match(home, /new Date\(\)\.getMonth\(\) === 10/);
  assert.match(home, /\{movemberVisible && \(/);
  assert.match(home, /movember-moustache\.svg/);
  assert.match(css, /\.premium-home__movember-moustache/);
  assert.match(moustache, /<svg/);
});
