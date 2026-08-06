import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { formatPublicEventPeriod } from "../.test-dist/src/features/home/domain/publicEventPresentation.js";

const migration = await readFile(
  "supabase/migrations/20260806090000_add_public_event_feed.sql",
  "utf8",
);
const service = await readFile(
  "src/features/home/services/publicEventService.ts",
  "utf8",
);
const homePage = await readFile(
  "src/features/home/pages/HomePage.tsx",
  "utf8",
);

test(
  "la projection publique ne renvoie que les évènements publiés et à venir",
  () => {
    assert.match(
      migration,
      /create or replace function public\.list_upcoming_events\(\)/,
    );
    assert.match(migration, /events\.publication_status = 'published'/);
    assert.match(migration, /events\.ends_at > now\(\)/);
    assert.match(migration, /events\.visibility = 'public'/);
    assert.match(migration, /events\.visibility = 'members'/);
    assert.doesNotMatch(migration, /events\.visibility = 'private'/);
    assert.match(migration, /order by events\.starts_at, events\.id/);
  },
);

test("les évènements membres exigent une appartenance réelle au club", () => {
  assert.match(migration, /members\.is_active/);
  assert.match(migration, /profiles\.id = auth\.uid\(\)/);
  assert.match(migration, /public\.club_memberships/);
  assert.match(migration, /memberships\.profile_id = auth\.uid\(\)/);
  assert.match(
    migration,
    /grant execute on function public\.list_upcoming_events\(\) to anon, authenticated/,
  );
});

test(
  "l’accueil consomme la projection sécurisée et distingue les évènements licenciés",
  () => {
    assert.match(service, /supabase\.rpc\("list_upcoming_events"\)/);
    assert.match(homePage, /Prochains évènements/);
    assert.match(homePage, /event\.visibility === "members"/);
    assert.match(homePage, /Licenciés/);
    assert.match(homePage, /formatPublicEventPeriod/);
  },
);

test(
  "le format d’une activité sur une journée utilise l’heure Europe\/Paris",
  () => {
    assert.equal(
      formatPublicEventPeriod(
        "2026-08-06T16:30:00.000Z",
        "2026-08-06T18:00:00.000Z",
      ),
      "Jeudi 6 août · 18h30–20h00",
    );
  },
);

test(
  "le format d’une activité sur plusieurs jours indique les deux périodes",
  () => {
    assert.equal(
      formatPublicEventPeriod(
        "2026-08-06T16:30:00.000Z",
        "2026-08-07T18:00:00.000Z",
      ),
      "Jeudi 6 août 18h30 → Vendredi 7 août 20h00",
    );
  },
);
