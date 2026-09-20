import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [nudge, shell, tournaments, reservations, pushService] =
  await Promise.all([
    read("../src/features/notifications/components/PushActivationNudge.tsx"),
    read("../src/features/user-space/components/UserSpaceShell.tsx"),
    read(
      "../src/features/user-space/tournaments/pages/MyTournamentsPage.tsx",
    ),
    read("../src/features/reservations/pages/ReservationsPage.tsx"),
    read("../src/features/notifications/services/pushNotificationService.ts"),
  ]);

test("la permission push n'est demandée qu'après un clic utilisateur", () => {
  assert.match(nudge, /const enable = async \(\) =>/);
  assert.match(nudge, /onClick=\{\(\) => void enable\(\)\}/);
  assert.match(nudge, /pushNotificationService\.enable\(\)/);
  assert.doesNotMatch(
    nudge,
    /useEffect\([\s\S]*pushNotificationService\.enable\(\)/,
  );
  assert.match(pushService, /Notification\.requestPermission\(\)/);
});

test("la relance disparaît lorsqu'un appareil est déjà abonné", () => {
  assert.match(
    nudge,
    /state\.subscribed[\s\S]*!state\.configured[\s\S]*return null/,
  );
});

test("Plus tard espace les relances selon le contexte", () => {
  assert.match(nudge, /general: 7/);
  assert.match(nudge, /tournament: 3/);
  assert.match(nudge, /championship: 7/);
  assert.match(nudge, /window\.localStorage\.setItem/);
  assert.match(nudge, /Plus tard/);
});

test("le tableau de bord explique l'intérêt général du push", () => {
  assert.match(shell, /PushActivationNudge context="general"/);
  assert.match(shell, /location\.pathname === ROUTES\.userSpace/);
});

test("Mes tournois met les reports au cœur de la relance", () => {
  assert.match(tournaments, /PushActivationNudge context="tournament"/);
  assert.match(nudge, /Ne ratez pas une demande de report/);
  assert.match(nudge, /qu’un horaire change/);
});

test("une réservation championnat confirmée propose les alertes", () => {
  assert.match(
    reservations,
    /championshipContext[\s\S]*PushActivationNudge context="championship" compact/,
  );
  assert.match(nudge, /Soyez prévenu si quelque chose change/);
});

test("iPhone non installé et permission bloquée renvoient vers l'aide", () => {
  assert.match(nudge, /state\.isIos && !state\.isStandalone/);
  assert.match(nudge, /permission === "denied"/);
  assert.match(nudge, /ROUTES\.myNotifications/);
  assert.match(nudge, /Voir comment les activer/);
});
