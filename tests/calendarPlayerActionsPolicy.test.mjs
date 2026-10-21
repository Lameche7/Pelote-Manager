import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const policy = readFileSync(new URL("../src/features/reservations/domain/calendarPlayerActions.ts", import.meta.url), "utf8");

test("calendar actions fail closed without resolved identity and authentication", () => {
  assert.match(policy, /!context\.identityResolved/);
  assert.match(policy, /!context\.isAuthenticated/);
});

test("results only for participants or assigned referees, and not after existing result", () => {
  assert.match(policy, /context\.isParticipant \|\| context\.isAssignedReferee/);
  assert.match(policy, /!context\.hasResult/);
  assert.match(policy, /context\.canSubmitResultNow/);
});

test("report requests are participants-only, volunteering has a dedicated right", () => {
  assert.match(policy, /context\.isParticipant && context\.canRequestReport/);
  assert.match(policy, /context\.canVolunteerForRefereeing/);
});
