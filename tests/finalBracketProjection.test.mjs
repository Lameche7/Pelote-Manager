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

test("un tableau à 6 montre les deux équipes possibles du barrage sur deux lignes", () => {
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
  assert.equal(semifinals[0].sideB.teamLabel, "Équipe 4\nou Équipe 5");
  assert.equal(semifinals[1].sideA.teamLabel, "Équipe 2");
  assert.equal(semifinals[1].sideB.teamLabel, "Équipe 3\nou Équipe 6");
});

test("un barrage déjà gagné remplace les alternatives par le vrai vainqueur", () => {
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

test("les tours suivants restent vides tant que leurs vainqueurs ne sont pas connus", () => {
  const projected = buildFinalBracketProjectedMatches({
    qualifierCount: 6,
    seeds,
    actualMatches: preliminaryMatches,
  });

  const final = projected.find((match) => match.round === "final");
  assert.equal(final?.sideA.teamLabel, "");
  assert.equal(final?.sideB.teamLabel, "");
});

test("un 1/8 réel non joué affiche aussi ses deux équipes possibles au tour suivant", () => {
  const seeds16 = Array.from({ length: 16 }, (_, index) => ({
    seed: index + 1,
    teamId: `team-${index + 1}`,
    teamLabel: `Équipe ${index + 1}`,
  }));
  const roundOf16Matches = Array.from({ length: 8 }, (_, index) => ({
    round: "round_of_16",
    displayOrder: index,
    teamAId: `round16-a-${index}`,
    teamALabel: `1/8 ${index + 1} A`,
    teamBId: `round16-b-${index}`,
    teamBLabel: `1/8 ${index + 1} B`,
    winnerTeamId: null,
  }));

  const projected = buildFinalBracketProjectedMatches({
    qualifierCount: 16,
    seeds: seeds16,
    actualMatches: roundOf16Matches,
  });

  const firstQuarterfinal = projected.find(
    (match) => match.round === "quarterfinal" && match.displayOrder === 0,
  );
  const firstSemifinal = projected.find(
    (match) => match.round === "semifinal" && match.displayOrder === 0,
  );

  assert.equal(firstQuarterfinal?.sideA.teamLabel, "1/8 1 A\nou 1/8 1 B");
  assert.equal(firstQuarterfinal?.sideB.teamLabel, "1/8 2 A\nou 1/8 2 B");
  assert.equal(firstSemifinal?.sideA.teamLabel, "");
  assert.equal(firstSemifinal?.sideB.teamLabel, "");
});

test("le tableau croisé place chaque première de poule contre le bon barrage", () => {
  const projected = buildFinalBracketProjectedMatches({
    qualifierCount: 6,
    crossPools: true,
    seeds,
    actualMatches: preliminaryMatches,
  });
  const semi = projected
    .filter((match) => match.round === "semifinal")
    .sort((a, b) => a.displayOrder - b.displayOrder);
  assert.equal(semi[0].sideA.teamLabel, "Équipe 1");
  assert.equal(semi[0].sideB.teamLabel, "Équipe 3\nou Équipe 6");
  assert.equal(semi[1].sideA.teamLabel, "Équipe 2");
  assert.equal(semi[1].sideB.teamLabel, "Équipe 4\nou Équipe 5");
});

test("Lourdes 3e série : Pasi / Pasi reste visible et Garoby / Lolibe n'est pas dupliqué", () => {
  const seeds24 = Array.from({ length: 24 }, (_, index) => ({
    seed: index + 1,
    teamId: `team-${index + 1}`,
    teamLabel: index === 6 ? "Pasi / Pasi" : `Équipe ${index + 1}`,
  }));
  const prelim = Array.from({ length: 8 }, (_, index) => ({
    round: "preliminary",
    displayOrder: index,
    teamAId: `team-${index + 9}`,
    teamALabel: `Équipe ${index + 9}`,
    teamBId: `team-${24 - index}`,
    teamBLabel: `Équipe ${24 - index}`,
    winnerTeamId: index === 5 ? "team-19" : null,
  }));
  const actual = [
    {
      round: "round_of_16",
      displayOrder: 6,
      teamAId: "team-3",
      teamALabel: "Garoby / Elorza",
      teamBId: "team-19",
      teamBLabel: "Lolibe / Bonamy",
      winnerTeamId: null,
    },
  ];
  const projected = buildFinalBracketProjectedMatches({
    qualifierCount: 24,
    seeds: seeds24,
    actualMatches: [...prelim, ...actual],
  });
  const eighths = projected.filter(
    (match) => match.round === "round_of_16",
  );
  assert.equal(eighths.length, 7);
  assert.equal(
    eighths.find((match) => match.displayOrder === 5)?.sideA.teamLabel,
    "Pasi / Pasi",
  );
  assert.equal(eighths.some((match) => match.displayOrder === 6), false);
  assert.equal(
    eighths.filter((match) => match.sideA.teamLabel === "Garoby / Elorza")
      .length,
    0,
  );
});
