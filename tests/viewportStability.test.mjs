import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(
  new URL("../src/main.tsx", import.meta.url),
  "utf8",
);
const viewport = await readFile(
  new URL("../src/styles/viewport.css", import.meta.url),
  "utf8",
);
const reservationsPage = await readFile(
  new URL(
    "../src/features/reservations/pages/ReservationsPage.tsx",
    import.meta.url,
  ),
  "utf8",
);
const reservationsResponsive = await readFile(
  new URL(
    "../src/features/reservations/pages/ReservationsResponsive.css",
    import.meta.url,
  ),
  "utf8",
);

test("charge la protection globale du viewport", () => {
  assert.match(main, /import "\.\/styles\/viewport\.css";/);
});

test("stabilise le shell sans couper un débordement horizontal réel", () => {
  assert.match(viewport, /html[\s\S]*overflow-x: auto;/);
  assert.match(viewport, /overscroll-behavior-x: contain;/);
  assert.doesNotMatch(viewport, /overflow-x: hidden;/);
  assert.doesNotMatch(viewport, /overflow-x: clip;/);
  assert.match(viewport, /\.app-layout,[\s\S]*\.app-main[\s\S]*min-width: 0;/);
  assert.match(
    viewport,
    /\.app-header,[\s\S]*\.app-main > \*[\s\S]*max-width: 100%;/,
  );
});

test("le calendrier mobile conserve son défilement horizontal autonome", () => {
  assert.match(
    reservationsPage,
    /import "\.\/ReservationsResponsive\.css";/,
  );
  assert.match(
    reservationsResponsive,
    /\.reservation-calendar__grid,[\s\S]*overflow-x: auto;/,
  );
  assert.match(reservationsResponsive, /-webkit-overflow-scrolling: touch;/);
  assert.match(reservationsResponsive, /touch-action: pan-x pan-y;/);
});
