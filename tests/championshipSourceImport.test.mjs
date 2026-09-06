import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChampionshipImportPreview,
  parseChampionshipPlayerEntry,
  parseChampionshipTeamLabel,
} from "../.test-dist/src/features/admin/championships/domain/championshipSourceImport.js";

const engagementHeaders = [
  "Compétition",
  "Spécialité",
  "Catégorie",
  "Poule",
  "Classement équipe",
  "Club - Num équipe",
  "Engagés",
  "Responsable",
  "Tel Responsable",
  "Commentaire",
];

const matchHeaders = [
  "Compétition",
  "Spécialité",
  "Catégorie",
  "Phase",
  "Date",
  "Heure",
  "Date Report",
  "Heure Report",
  "Lieu",
  "Date Entente",
  "Heure Entente",
  "Lieu Entente",
  "Equipe 1 - Club",
  "Equipe 2 - Club",
  "Score",
  "DIRECTIVES",
  "DELEGUES",
  "ARBITRE",
  "COMMENTAIRE_RESULTAT",
];

test("sépare le club et le numéro d’équipe sans confondre les séries", () => {
  assert.deepEqual(parseChampionshipTeamLabel("CLUB ALPHA 02"), {
    clubName: "CLUB ALPHA",
    teamNumber: "02",
  });
  assert.equal(parseChampionshipTeamLabel("CLUB SANS NUMERO"), null);
});

test("lit l’identité sportive et les indicateurs accolés à la licence", () => {
  assert.deepEqual(parseChampionshipPlayerEntry("DUPONT Jean (012345) (S+)"), {
    licenceNumber: "012345",
    firstName: "Jean",
    lastName: "DUPONT",
    normalizedFirstName: "JEAN",
    normalizedLastName: "DUPONT",
    sourceEntry: "DUPONT Jean (012345) (S+)",
    sourceFlags: ["S+"],
  });
});

test("croise parties et engagements avant toute validation", () => {
  const engagements = [
    engagementHeaders,
    [
      "CHAMPIONNAT TEST",
      "Paleta gomme pleine masculin",
      "Senior 1ère Série",
      "1",
      "",
      "CLUB ALPHA 01",
      "DUPONT Jean (012345) - MARTIN Paul (067890)",
      "",
      "",
      "",
    ],
    [
      "CHAMPIONNAT TEST",
      "Paleta gomme pleine masculin",
      "Senior 1ère Série",
      "1",
      "",
      "CLUB BETA 01",
      "DURAND Luc (023456) - ROBERT Marc (078901) (E)",
      "",
      "",
      "",
    ],
    [
      "CHAMPIONNAT TEST",
      "Paleta gomme pleine masculin",
      "M22",
      "",
      "",
      "CLUB ALPHA 01",
      "PETIT Hugo (034567) - ROY Nils (089012)",
      "",
      "",
      "",
    ],
  ];
  const matches = [
    matchHeaders,
    [
      "CHAMPIONNAT TEST",
      "Paleta gomme pleine masculin",
      "Senior 1ère Série",
      "Poules",
      45942,
      "17h30",
      "",
      "",
      "Trinquet",
      "",
      "",
      "",
      "CLUB ALPHA 01",
      "CLUB BETA 01",
      "40/32",
      "",
      "",
      "",
      "",
    ],
  ];

  const preview = buildChampionshipImportPreview(matches, engagements);

  assert.equal(preview.valid, true);
  assert.equal(preview.competition, "CHAMPIONNAT TEST");
  assert.equal(preview.teamCount, 3);
  assert.equal(preview.playerCount, 6);
  assert.equal(preview.matchCount, 1);
  assert.equal(preview.poolCount, 1);
  assert.equal(preview.federationClubs.length, 2);
  assert.equal(preview.divisions.length, 2);
  assert.equal(preview.matches[0].scheduledOn, "2025-10-12");
  assert.equal(preview.matches[0].scheduledTime, "17:30");
  assert.equal(preview.matches[0].status, "played");
  assert.equal(preview.matches[0].scoreTeam1, 40);
  assert.equal(preview.matches[0].scoreTeam2, 32);
});

test("bloque la prévisualisation si une équipe des parties manque aux engagements", () => {
  const preview = buildChampionshipImportPreview(
    [
      matchHeaders,
      [
        "CHAMPIONNAT TEST",
        "Paleta gomme pleine masculin",
        "Senior 1ère Série",
        "Poules",
        "12/10/2025",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "CLUB ALPHA 01",
        "CLUB INCONNU 01",
        "",
        "",
        "",
        "",
        "",
      ],
    ],
    [
      engagementHeaders,
      [
        "CHAMPIONNAT TEST",
        "Paleta gomme pleine masculin",
        "Senior 1ère Série",
        "1",
        "",
        "CLUB ALPHA 01",
        "DUPONT Jean (012345) - MARTIN Paul (067890)",
        "",
        "",
        "",
      ],
    ],
  );

  assert.equal(preview.valid, false);
  assert.ok(
    preview.issues.some(
      (issue) =>
        issue.source === "cross" && issue.message.includes("CLUB INCONNU 01"),
    ),
  );
});
