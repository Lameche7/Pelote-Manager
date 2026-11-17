import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read(
  "../src/features/user-space/tournaments/pages/MyTournamentsPage.tsx",
);
const calendar = read(
  "../src/features/reservations/services/reservationCalendarService.ts",
);
const card = read("../src/features/reservations/components/SlotCard.tsx");
const migration = read(
  "../supabase/migrations/20261117094500_public_full_finals_calendar_projection.sql",
);

test(
  "Mes tournois can collapse and lazily load editable finals availabilities",
  () => {
    assert.match(page, /Afficher \/ masquer mes disponibilités — phase finale/);
    assert.match(page, /onToggle=.*setExpanded/);
    assert.match(page, /tournamentService\.getMyFinalsAvailabilities/);
    assert.match(page, /TournamentFinalsAvailabilityEditor/);
    assert.match(page, /onSaved=\{reload\}/);
  },
);

test(
  "calendar shows all future finals nodes without converting them to actual matches",
  () => {
    assert.match(migration, /tournament_final_planning_nodes/);
    assert.match(migration, /node\.round_number/);
    assert.match(migration, /planning_published', 'in_progress/);
    assert.match(migration, /adversaires à déterminer \(prévisionnel\)/);
    assert.match(migration, /not exists \(/);
    assert.match(
    calendar,
    /list_public_tournament_final_calendar_projections/,
  );
    assert.match(calendar, /slot.status === "occupied"/);
    assert.match(calendar, /tournament_finals_projection/);
    assert.match(card, /Phase finale · prévisionnel/);
    assert.doesNotMatch(migration, /insert into public\.tournament_matches/);
    assert.doesNotMatch(migration, /update public\.reservations/);
  },
);
