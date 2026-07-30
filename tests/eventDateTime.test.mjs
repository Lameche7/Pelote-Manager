import test from "node:test";
import assert from "node:assert/strict";
import {
  localInputToStoredDateTime,
  storedDateTimeToLocalInput,
} from "../.test-dist/src/features/admin/events/domain/eventDateTime.js";
import { submitEventDraft } from "../.test-dist/src/features/admin/events/domain/eventFormSubmission.js";

test("convertit une heure d’été Europe/Paris vers timestamptz sans décalage visuel", () => {
  const stored = localInputToStoredDateTime("2026-07-15T10:00");
  assert.equal(stored, "2026-07-15T08:00:00.000Z");
  assert.equal(storedDateTimeToLocalInput(stored), "2026-07-15T10:00");
});

test("convertit une heure d’hiver Europe/Paris vers timestamptz sans décalage visuel", () => {
  const stored = localInputToStoredDateTime("2026-01-15T10:00");
  assert.equal(stored, "2026-01-15T09:00:00.000Z");
  assert.equal(storedDateTimeToLocalInput(stored), "2026-01-15T10:00");
});

test("ouvrir puis réenregistrer conserve exactement l’instant stocké", () => {
  for (const stored of [
    "2026-07-15T08:00:00.000Z",
    "2026-01-15T09:00:00.000Z",
  ]) {
    assert.equal(
      localInputToStoredDateTime(storedDateTimeToLocalInput(stored)),
      stored,
    );
  }
});

test("une erreur de sauvegarde est renvoyée et laisse le brouillon à l’appelant", async () => {
  const draft = {
    name: "Stage",
    startsAt: "2026-07-15T10:00",
    endsAt: "2026-07-15T12:00",
  };
  const result = await submitEventDraft(draft, async () => {
    throw new Error("Ce créneau est déjà occupé");
  });
  assert.deepEqual(result, {
    ok: false,
    message: "Ce créneau est déjà occupé",
  });
  assert.equal(draft.startsAt, "2026-07-15T10:00");
});
