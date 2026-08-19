import assert from "node:assert/strict";
import test from "node:test";
import { getFinalStageEncouragement } from "../.test-dist/src/features/tournaments/domain/finalStageEncouragement.js";

test("un meme match conserve la meme phrase", () => {
  const first = getFinalStageEncouragement({
    round: "quarterfinal",
    state: "pre_match",
    stableKey: "match-123",
  });
  const second = getFinalStageEncouragement({
    round: "quarterfinal",
    state: "pre_match",
    stableKey: "match-123",
  });

  assert.equal(first, second);
});

test("chaque moment sportif fournit un message", () => {
  const rounds = [
    "preliminary",
    "round_of_16",
    "quarterfinal",
    "semifinal",
    "final",
  ];
  const states = ["pre_match", "qualified", "eliminated"];

  for (const round of rounds) {
    for (const state of states) {
      const message = getFinalStageEncouragement({
        round,
        state,
        stableKey: `${round}-${state}`,
      });

      assert.equal(typeof message, "string");
      assert.ok(message.length > 10);
    }
  }
});

test("le barrage peut afficher le ton valide", () => {
  const message = getFinalStageEncouragement({
    round: "preliminary",
    state: "pre_match",
    stableKey: "barrage-9-24",
  });

  assert.match(
    message,
    /Rien à perdre|tableau commence|prochain est le seul qui compte/,
  );
});
