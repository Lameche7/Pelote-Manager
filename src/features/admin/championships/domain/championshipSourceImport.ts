export type ChampionshipImportSource = "matches" | "engagements" | "cross";
export type ChampionshipImportIssueSeverity = "error" | "warning";
export type ChampionshipMatchStatus =
  | "to_schedule"
  | "scheduled"
  | "postponed"
  | "played"
  | "forfeit"
  | "cancelled";

export type ChampionshipImportIssue = {
  source: ChampionshipImportSource;
  row: number;
  severity: ChampionshipImportIssueSeverity;
  message: string;
};

export type ChampionshipImportPlayer = {
  licenceNumber: string;
  firstName: string;
  lastName: string;
  normalizedFirstName: string;
  normalizedLastName: string;
  sourceEntry: string;
  sourceFlags: string[];
};

export type ChampionshipImportEngagement = {
  row: number;
  competition: string;
  specialty: string;
  category: string;
  poolCode: string | null;
  sourceRank: number | null;
  teamLabel: string;
  clubName: string;
  teamNumber: string;
  players: ChampionshipImportPlayer[];
};

export type ChampionshipImportMatch = {
  row: number;
  competition: string;
  specialty: string;
  category: string;
  phase: string;
  team1Label: string;
  team2Label: string;
  scheduledOn: string | null;
  scheduledTime: string | null;
  reportOn: string | null;
  reportTime: string | null;
  venue: string | null;
  agreementOn: string | null;
  agreementTime: string | null;
  agreementVenue: string | null;
  status: ChampionshipMatchStatus;
  scoreRaw: string | null;
  scoreTeam1: number | null;
  scoreTeam2: number | null;
  resultComment: string | null;
  sourceKey: string;
  sourceMetadata: Record<string, string>;
};

export type ChampionshipImportDivisionPreview = {
  name: string;
  poolCount: number;
  teamCount: number;
  playerCount: number;
  matchCount: number;
  teamsWithoutPool: number;
};

export type ChampionshipImportPreview = {
  valid: boolean;
  competition: string | null;
  specialty: string | null;
  divisions: ChampionshipImportDivisionPreview[];
  federationClubs: string[];
  engagements: ChampionshipImportEngagement[];
  matches: ChampionshipImportMatch[];
  uniquePlayers: ChampionshipImportPlayer[];
  issues: ChampionshipImportIssue[];
  teamCount: number;
  playerCount: number;
  matchCount: number;
  poolCount: number;
};

type ParseResult<T> = {
  rows: T[];
  issues: ChampionshipImportIssue[];
};

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();

const normalizeIdentity = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, " ")
    .trim();

const cellText = (value: unknown) => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).replace(/\s+/gu, " ").trim();
};

const nullableText = (value: unknown) => cellText(value) || null;

const findHeaderRow = (data: unknown[][], requiredHeaders: string[]) => {
  const maximum = Math.min(data.length, 20);
  for (let index = 0; index < maximum; index += 1) {
    const normalized = new Set((data[index] ?? []).map((value) => fold(cellText(value))));
    if (requiredHeaders.every((header) => normalized.has(header))) return index;
  }
  return -1;
};

const columnMap = (row: unknown[]) =>
  new Map(row.map((value, index) => [fold(cellText(value)), index] as const));

const valueAt = (row: unknown[], columns: Map<string, number>, name: string) => {
  const index = columns.get(name);
  return index === undefined ? null : (row[index] ?? null);
};

const excelDate = (serial: number) => {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const epoch = Date.UTC(1899, 11, 30);
  const date = new Date(epoch + Math.floor(serial) * 86_400_000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const parseDate = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${String(value.getFullYear()).padStart(4, "0")}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  if (typeof value === "number") return excelDate(value);

  const clean = cellText(value);
  let match = clean.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/u);
  if (match) {
    const [, year, month, day] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  match = clean.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/u);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
};

const parseTime = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const fraction = ((value % 1) + 1) % 1;
    const minutes = Math.round(fraction * 24 * 60) % (24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }

  const match = cellText(value).match(/^(\d{1,2})\s*(?:h|:)\s*(\d{1,2})/iu);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

const parsePositiveInteger = (value: unknown) => {
  const clean = cellText(value);
  if (!/^\d+$/u.test(clean)) return null;
  const parsed = Number(clean);
  return parsed > 0 ? parsed : null;
};

export const parseChampionshipTeamLabel = (value: string) => {
  const match = value.trim().match(/^(.*\S)\s+(\d{1,3})$/u);
  if (!match) return null;
  return { clubName: match[1].trim(), teamNumber: match[2] };
};

const isUpperNameToken = (token: string) => {
  const letters = token.replace(/[^\p{L}]/gu, "");
  return Boolean(letters) && letters === letters.toLocaleUpperCase("fr-FR");
};

export const parseChampionshipPlayerEntry = (
  value: string,
): ChampionshipImportPlayer | null => {
  const match = value.trim().match(/^(.*?)\s+\((\d{5,6})\)(.*)$/u);
  if (!match) return null;

  const name = match[1].trim();
  const tokens = name.split(/\s+/u);
  const firstNameIndex = tokens.findIndex((token) => !isUpperNameToken(token));
  if (firstNameIndex <= 0) return null;

  const lastName = tokens.slice(0, firstNameIndex).join(" ");
  const firstName = tokens.slice(firstNameIndex).join(" ");
  const sourceFlags = Array.from(match[3].matchAll(/\(([^)]+)\)/gu), (item) =>
    item[1].trim(),
  ).filter(Boolean);

  return {
    licenceNumber: match[2],
    firstName,
    lastName,
    normalizedFirstName: normalizeIdentity(firstName),
    normalizedLastName: normalizeIdentity(lastName),
    sourceEntry: value.trim(),
    sourceFlags,
  };
};

const engagementRequiredHeaders = [
  "competition",
  "specialite",
  "categorie",
  "poule",
  "club num equipe",
  "engages",
];

export const parseChampionshipEngagementRows = (
  data: unknown[][],
): ParseResult<ChampionshipImportEngagement> => {
  const issues: ChampionshipImportIssue[] = [];
  const rows: ChampionshipImportEngagement[] = [];
  const headerIndex = findHeaderRow(data, engagementRequiredHeaders);
  if (headerIndex < 0) {
    return {
      rows,
      issues: [
        {
          source: "engagements",
          row: 0,
          severity: "error",
          message: "Les colonnes attendues du fichier d’engagements n’ont pas été reconnues.",
        },
      ],
    };
  }

  const columns = columnMap(data[headerIndex] ?? []);
  data.slice(headerIndex + 1).forEach((sourceRow, offset) => {
    const rowNumber = headerIndex + offset + 2;
    const teamLabel = cellText(valueAt(sourceRow, columns, "club num equipe"));
    if (!teamLabel) return;

    const competition = cellText(valueAt(sourceRow, columns, "competition"));
    const specialty = cellText(valueAt(sourceRow, columns, "specialite"));
    const category = cellText(valueAt(sourceRow, columns, "categorie"));
    const parsedTeam = parseChampionshipTeamLabel(teamLabel);
    if (!competition || !specialty || !category || !parsedTeam) {
      issues.push({
        source: "engagements",
        row: rowNumber,
        severity: "error",
        message: parsedTeam
          ? "Compétition, spécialité ou catégorie manquante."
          : `Impossible de séparer le club et le numéro d’équipe dans « ${teamLabel} ».`,
      });
      return;
    }

    const playerText = cellText(valueAt(sourceRow, columns, "engages"));
    const playerParts = playerText.split(/\s+-\s+/u).filter(Boolean);
    const players = playerParts
      .map(parseChampionshipPlayerEntry)
      .filter((player): player is ChampionshipImportPlayer => player !== null);
    if (players.length !== playerParts.length || players.length === 0) {
      issues.push({
        source: "engagements",
        row: rowNumber,
        severity: "error",
        message: "Un ou plusieurs joueurs n’ont pas pu être lus avec leur numéro de licence.",
      });
      return;
    }

    rows.push({
      row: rowNumber,
      competition,
      specialty,
      category,
      poolCode: nullableText(valueAt(sourceRow, columns, "poule")),
      sourceRank: parsePositiveInteger(valueAt(sourceRow, columns, "classement equipe")),
      teamLabel,
      clubName: parsedTeam.clubName,
      teamNumber: parsedTeam.teamNumber,
      players,
    });
  });

  return { rows, issues };
};

const matchRequiredHeaders = [
  "competition",
  "specialite",
  "categorie",
  "phase",
  "equipe 1 club",
  "equipe 2 club",
];

const parseScore = (value: unknown) => {
  const raw = nullableText(value);
  if (!raw) return { raw: null, team1: null, team2: null };
  const match = raw.match(/^(\d+)\s*[/-]\s*(\d+)$/u);
  if (!match) return { raw, team1: null, team2: null };
  return { raw, team1: Number(match[1]), team2: Number(match[2]) };
};

const matchStatus = (
  scoreRaw: string | null,
  scheduledOn: string | null,
  reportOn: string | null,
): ChampionshipMatchStatus => {
  if (scoreRaw) return "played";
  if (reportOn) return "postponed";
  if (scheduledOn) return "scheduled";
  return "to_schedule";
};

export const parseChampionshipMatchRows = (
  data: unknown[][],
): ParseResult<ChampionshipImportMatch> => {
  const issues: ChampionshipImportIssue[] = [];
  const rows: ChampionshipImportMatch[] = [];
  const headerIndex = findHeaderRow(data, matchRequiredHeaders);
  if (headerIndex < 0) {
    return {
      rows,
      issues: [
        {
          source: "matches",
          row: 0,
          severity: "error",
          message: "Les colonnes attendues du fichier des parties n’ont pas été reconnues.",
        },
      ],
    };
  }

  const columns = columnMap(data[headerIndex] ?? []);
  const sourceKeys = new Set<string>();
  data.slice(headerIndex + 1).forEach((sourceRow, offset) => {
    const rowNumber = headerIndex + offset + 2;
    const team1Label = cellText(valueAt(sourceRow, columns, "equipe 1 club"));
    const team2Label = cellText(valueAt(sourceRow, columns, "equipe 2 club"));
    if (!team1Label && !team2Label) return;

    const competition = cellText(valueAt(sourceRow, columns, "competition"));
    const specialty = cellText(valueAt(sourceRow, columns, "specialite"));
    const category = cellText(valueAt(sourceRow, columns, "categorie"));
    const phase = cellText(valueAt(sourceRow, columns, "phase"));
    if (!competition || !specialty || !category || !phase || !team1Label || !team2Label) {
      issues.push({
        source: "matches",
        row: rowNumber,
        severity: "error",
        message: "Une partie est incomplète : compétition, série, phase ou équipe manquante.",
      });
      return;
    }

    const scheduledOn = parseDate(valueAt(sourceRow, columns, "date"));
    const reportOn = parseDate(valueAt(sourceRow, columns, "date report"));
    const agreementOn = parseDate(valueAt(sourceRow, columns, "date entente"));
    const score = parseScore(valueAt(sourceRow, columns, "score"));
    const sourceKeyBase = [
      fold(category),
      fold(phase),
      fold(team1Label),
      fold(team2Label),
      scheduledOn ?? "",
      reportOn ?? "",
    ].join("|");
    const sourceKey = sourceKeys.has(sourceKeyBase)
      ? `${sourceKeyBase}|row:${rowNumber}`
      : sourceKeyBase;
    if (sourceKeys.has(sourceKeyBase)) {
      issues.push({
        source: "matches",
        row: rowNumber,
        severity: "warning",
        message: "Cette partie ressemble à une autre ligne ; son numéro de ligne complète sa clé source.",
      });
    }
    sourceKeys.add(sourceKeyBase);

    const sourceMetadata: Record<string, string> = {};
    for (const [column, key] of [
      ["directives", "directives"],
      ["delegues", "delegates"],
      ["arbitre", "referee"],
    ] as const) {
      const text = cellText(valueAt(sourceRow, columns, column));
      if (text) sourceMetadata[key] = text;
    }

    rows.push({
      row: rowNumber,
      competition,
      specialty,
      category,
      phase,
      team1Label,
      team2Label,
      scheduledOn,
      scheduledTime: parseTime(valueAt(sourceRow, columns, "heure")),
      reportOn,
      reportTime: parseTime(valueAt(sourceRow, columns, "heure report")),
      venue: nullableText(valueAt(sourceRow, columns, "lieu")),
      agreementOn,
      agreementTime: parseTime(valueAt(sourceRow, columns, "heure entente")),
      agreementVenue: nullableText(valueAt(sourceRow, columns, "lieu entente")),
      status: matchStatus(score.raw, scheduledOn, reportOn),
      scoreRaw: score.raw,
      scoreTeam1: score.team1,
      scoreTeam2: score.team2,
      resultComment: nullableText(valueAt(sourceRow, columns, "commentaire resultat")),
      sourceKey,
      sourceMetadata,
    });
  });

  return { rows, issues };
};

const singleValue = (
  values: string[],
  label: string,
  issues: ChampionshipImportIssue[],
) => {
  const unique = Array.from(new Set(values.filter(Boolean)));
  if (unique.length !== 1) {
    issues.push({
      source: "cross",
      row: 0,
      severity: "error",
      message:
        unique.length === 0
          ? `${label} absent des fichiers.`
          : `Plusieurs valeurs de ${label.toLowerCase()} ont été détectées dans les fichiers.`,
    });
    return null;
  }
  return unique[0];
};

export const buildChampionshipImportPreview = (
  matchData: unknown[][],
  engagementData: unknown[][],
): ChampionshipImportPreview => {
  const matchResult = parseChampionshipMatchRows(matchData);
  const engagementResult = parseChampionshipEngagementRows(engagementData);
  const issues = [...matchResult.issues, ...engagementResult.issues];
  const engagements = engagementResult.rows;
  const matches = matchResult.rows;

  const competition = singleValue(
    [...matches.map((row) => row.competition), ...engagements.map((row) => row.competition)],
    "Compétition",
    issues,
  );
  const specialty = singleValue(
    [...matches.map((row) => row.specialty), ...engagements.map((row) => row.specialty)],
    "Spécialité",
    issues,
  );

  const teams = new Map<string, ChampionshipImportEngagement>();
  for (const row of engagements) {
    const key = `${fold(row.category)}|${fold(row.teamLabel)}`;
    if (teams.has(key)) {
      issues.push({
        source: "engagements",
        row: row.row,
        severity: "error",
        message: `L’équipe « ${row.teamLabel} » apparaît plusieurs fois dans la série « ${row.category} ».`,
      });
      continue;
    }
    teams.set(key, row);
  }

  for (const row of matches) {
    for (const teamLabel of [row.team1Label, row.team2Label]) {
      if (teams.has(`${fold(row.category)}|${fold(teamLabel)}`)) continue;
      issues.push({
        source: "cross",
        row: row.row,
        severity: "error",
        message: `L’équipe « ${teamLabel} » de la série « ${row.category} » existe dans les parties mais pas dans les engagements.`,
      });
    }
  }

  const playersByLicence = new Map<string, ChampionshipImportPlayer>();
  for (const engagement of engagements) {
    for (const player of engagement.players) {
      const existing = playersByLicence.get(player.licenceNumber);
      if (
        existing &&
        (existing.normalizedFirstName !== player.normalizedFirstName ||
          existing.normalizedLastName !== player.normalizedLastName)
      ) {
        issues.push({
          source: "cross",
          row: engagement.row,
          severity: "error",
          message: `Le numéro de licence ${player.licenceNumber} est associé à deux identités différentes.`,
        });
        continue;
      }
      if (!existing) playersByLicence.set(player.licenceNumber, player);
    }
  }

  const categories = Array.from(
    new Set([...engagements.map((row) => row.category), ...matches.map((row) => row.category)]),
  );
  const divisions = categories.map((name) => {
    const divisionEngagements = engagements.filter((row) => row.category === name);
    const divisionMatches = matches.filter((row) => row.category === name);
    const pools = new Set(
      divisionEngagements.map((row) => row.poolCode).filter((code): code is string => Boolean(code)),
    );
    const players = new Set(
      divisionEngagements.flatMap((row) => row.players.map((player) => player.licenceNumber)),
    );
    return {
      name,
      poolCount: pools.size,
      teamCount: divisionEngagements.length,
      playerCount: players.size,
      matchCount: divisionMatches.length,
      teamsWithoutPool: divisionEngagements.filter((row) => !row.poolCode).length,
    };
  });

  const federationClubs = Array.from(new Set(engagements.map((row) => row.clubName))).sort(
    (a, b) => a.localeCompare(b, "fr"),
  );
  const uniquePlayers = Array.from(playersByLicence.values());

  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    competition,
    specialty,
    divisions,
    federationClubs,
    engagements,
    matches,
    uniquePlayers,
    issues,
    teamCount: engagements.length,
    playerCount: uniquePlayers.length,
    matchCount: matches.length,
    poolCount: divisions.reduce((total, division) => total + division.poolCount, 0),
  };
};
