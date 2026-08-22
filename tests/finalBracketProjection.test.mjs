import assert from "node:assert/strict";
import test from "node:test";
import { buildFinalBracketProjectedMatches } from "../.test-dist/src/features/tournaments/domain/finalBracketProjection.js";

const seeds = Array.from({ length: 6 }, (_, index) => ({
  seed: index + 1,
  teamId: `team-${index + 1}`,
  teamLabel: `Équipe ${index + 1}`,
}));

const preliminaryMatches = [
  {
    round: "preliminary",
    displayOrder: 0,
    teamAId: "team-3",
    teamALabel: "Équipe 3",
    teamBId: "team-6",
    teamBLabel: "Équipe 6",
    winnerTeamId: null,
  },
  {
    round: "preliminary",
    displayOrder: 1,
    teamAId: "team-4",
    teamALabel: "Équipe 4",
    teamBId: "team-5",
    teamBLabel: "Équipe 5",
    winnerTeamId: null,
  },
];

test("un tableau à 6 montre les qualifiés directs face au barrage explicite", () => {
  const projected = buildFinalBracketProjectedMatches({
    qualifierCount: 6,
    seeds,
    actualMatches: preliminaryMatches,
  });

  const semifinals = projected
    .filter((match) => match.round === "semifinal")
    .sort((left, right) => left.displayOrder - right.displayOrder);

  assert.equal(semifinals.length, 2);
  assert.equal(semifinals[0].sideA.teamLabel, "Équipe 1");
  assert.equal(
    semifinals[0].sideB.teamLabel,
    "Vainqueur du barrage : Équipe 4 – Équipe 5",
  );
  assert.equal(semifinals[1].sideA.teamLabel, "Équipe 2");
  assert.equal(
    semifinals[1].sideB.teamLabel,
    "Vainqueur du barrage : Équipe 3 – Équipe 6",
  );
});

test("un barrage déjà gagné remplace son libellé par le vrai vainqueur", () => {
  const projected = buildFinalBracketProjectedMatches({
    qualifierCount: 6,
    seeds,
    actualMatches: [
      preliminaryMatches[0],
      { ...preliminaryMatches[1], winnerTeamId: "team-5" },
    ],
  });

  const firstSemifinal = projected.find(
    (match) => match.round === "semifinal" && match.displayOrder === 0,
  );

  assert.equal(firstSemifinal?.sideA.teamLabel, "Équipe 1");
  assert.equal(firstSemifinal?.sideB.teamLabel, "Équipe 5");
});

test("la finale explicite aussi les demi-finales qui l'alimentent", () => {
  const projected = buildFinalBracketProjectedMatches({
    qualifierCount: 6,
    seeds,
    actualMatches: preliminaryMatches,
  });

  const final = projected.find((match) => match.round === "final");
  assert.equal(
    final?.sideA.teamLabel,
    "Vainqueur de la demi-finale : Équipe 1 – Vainqueur du barrage : Équipe 4 – Équipe 5",
  );
  assert.equal(
    final?.sideB.teamLabel,
    "Vainqueur de la demi-finale : Équipe 2 – Vainqueur du barrage : Équipe 3 – Équipe 6",
  );
});
