export type ChampionshipStandingIssue = {
  row: number;
  severity: "error" | "warning";
  message: string;
};

export type ChampionshipStandingImportRow = {
  row: number;
  division: string;
  divisionNormalized: string;
  poolCode: string;
  teamLabel: string;
  clubName: string;
  clubNormalized: string;
  teamNumber: string;
  rank: number;
  played: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  points: number | null;
  scoreFor: number | null;
  scoreAgainst: number | null;
  scoreDifference: number | null;
  sourcePayload: Record<string, string>;
};

export type ChampionshipGeneralStandingImportRow =
  ChampionshipStandingImportRow & {
    poolRank: number;
  };

export type ChampionshipStandingsPreviewFile = {
  standings: ChampionshipStandingImportRow[];
  issues: ChampionshipStandingIssue[];
  valid: boolean;
};

export type ChampionshipStandingsFileDescriptor = {
  kind: "standings";
  fileName: string;
  checksum: string;
  rowCount: number;
  sourceUrl: string | null;
};

export type ChampionshipStandingsImportPayload = {
  file: ChampionshipStandingsFileDescriptor;
  standings: ChampionshipStandingImportRow[];
  generalStandings?: ChampionshipGeneralStandingImportRow[];
};

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();

const text = (value: unknown) =>
  value === null || value === undefined
    ? ""
    : String(value).replace(/\s+/gu, " ").trim();

const nullableNumber = (value: unknown) => {
  const clean = text(value).replace(/\s/gu, "").replace(",", ".");
  if (!clean || !/^-?\d+(?:\.\d+)?$/u.test(clean)) return null;
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
};

const positiveInteger = (value: unknown) => {
  const parsed = nullableNumber(value);
  return parsed !== null && Number.isInteger(parsed) && parsed > 0
    ? parsed
    : null;
};

const optionalInteger = (value: unknown) => {
  const parsed = nullableNumber(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
};

const aliases = {
  division: ["categorie", "catégorie", "serie", "série", "division"],
  pool: ["poule", "pool"],
  team: ["club num equipe", "club n equipe", "equipe", "équipe", "equipe club"],
  rank: ["classement", "rang", "rank", "classement equipe"],
  played: ["joues", "joués", "j", "matchs joues", "matchs joués"],
  wins: ["victoires", "v", "gagnes", "gagnés"],
  draws: ["nuls", "n", "draws"],
  losses: ["defaites", "défaites", "d", "perdus"],
  points: ["points", "pts", "point"],
  scoreFor: ["pour", "points pour", "score pour", "bp", "+"],
  scoreAgainst: ["contre", "points contre", "score contre", "bc", "-"],
  difference: [
    "difference",
    "différence",
    "diff",
    "+/-",
    "goal average",
    "goal-average",
  ],
} as const;

const findColumn = (headers: string[], names: readonly string[]) => {
  const normalized = headers.map(fold);
  for (const alias of names) {
    const index = normalized.indexOf(fold(alias));
    if (index >= 0) return index;
  }
  return -1;
};

const parseTeam = (value: string) => {
  const clean = value.trim();
  const match = clean.match(/^(.*\S)\s+(\d{1,3})$/u);
  if (!match) return null;
  return {
    clubName: match[1].trim(),
    teamNumber: match[2],
  };
};

const detectHeader = (data: unknown[][]) => {
  const maximum = Math.min(data.length, 30);
  for (let index = 0; index < maximum; index += 1) {
    const headers = (data[index] ?? []).map(text);
    if (
      findColumn(headers, aliases.division) >= 0 &&
      findColumn(headers, aliases.pool) >= 0 &&
      findColumn(headers, aliases.team) >= 0 &&
      findColumn(headers, aliases.rank) >= 0
    ) {
      return index;
    }
  }
  return -1;
};

export const parseChampionshipStandingRows = (
  data: unknown[][],
): ChampionshipStandingsPreviewFile => {
  const issues: ChampionshipStandingIssue[] = [];
  const standings: ChampionshipStandingImportRow[] = [];
  const headerIndex = detectHeader(data);
  if (headerIndex < 0) {
    return {
      standings,
      valid: false,
      issues: [
        {
          row: 0,
          severity: "error",
          message:
            "Les colonnes du classement n’ont pas été reconnues. Il faut au minimum la série, la poule, l’équipe et le rang.",
        },
      ],
    };
  }

  const headers = (data[headerIndex] ?? []).map(text);
  const columns = {
    division: findColumn(headers, aliases.division),
    pool: findColumn(headers, aliases.pool),
    team: findColumn(headers, aliases.team),
    rank: findColumn(headers, aliases.rank),
    played: findColumn(headers, aliases.played),
    wins: findColumn(headers, aliases.wins),
    draws: findColumn(headers, aliases.draws),
    losses: findColumn(headers, aliases.losses),
    points: findColumn(headers, aliases.points),
    scoreFor: findColumn(headers, aliases.scoreFor),
    scoreAgainst: findColumn(headers, aliases.scoreAgainst),
    difference: findColumn(headers, aliases.difference),
  };

  const valueAt = (row: unknown[], index: number) =>
    index < 0 ? null : (row[index] ?? null);

  data.slice(headerIndex + 1).forEach((row, offset) => {
    const rowNumber = headerIndex + offset + 2;
    const division = text(valueAt(row, columns.division));
    const poolCode = text(valueAt(row, columns.pool)).replace(
      /^poule\s+/iu,
      "",
    );
    const teamLabel = text(valueAt(row, columns.team));
    const rank = positiveInteger(valueAt(row, columns.rank));
    if (!division && !poolCode && !teamLabel) return;

    const parsedTeam = parseTeam(teamLabel);
    if (!division || !poolCode || !parsedTeam || rank === null) {
      issues.push({
        row: rowNumber,
        severity: "error",
        message: `Ligne ${rowNumber} incomplète : série, poule, équipe ou classement non exploitable.`,
      });
      return;
    }

    const played = optionalInteger(valueAt(row, columns.played));
    const wins = optionalInteger(valueAt(row, columns.wins));
    const draws = optionalInteger(valueAt(row, columns.draws));
    const losses = optionalInteger(valueAt(row, columns.losses));
    const scoreFor = optionalInteger(valueAt(row, columns.scoreFor));
    const scoreAgainst = optionalInteger(valueAt(row, columns.scoreAgainst));
    const providedDifference = optionalInteger(
      valueAt(row, columns.difference),
    );
    const scoreDifference =
      providedDifference ??
      (scoreFor !== null && scoreAgainst !== null
        ? scoreFor - scoreAgainst
        : null);

    standings.push({
      row: rowNumber,
      division,
      divisionNormalized: fold(division),
      poolCode,
      teamLabel,
      clubName: parsedTeam.clubName,
      clubNormalized: fold(parsedTeam.clubName),
      teamNumber: parsedTeam.teamNumber,
      rank,
      played,
      wins,
      draws,
      losses,
      points: nullableNumber(valueAt(row, columns.points)),
      scoreFor,
      scoreAgainst,
      scoreDifference,
      sourcePayload: Object.fromEntries(
        headers
          .map((header, index) => [header, text(row[index])] as const)
          .filter(([header, value]) => header && value),
      ),
    });
  });

  if (standings.length === 0 && issues.length === 0) {
    issues.push({
      row: 0,
      severity: "error",
      message: "Aucune ligne de classement n’a été détectée.",
    });
  }

  return {
    standings,
    issues,
    valid: !issues.some((issue) => issue.severity === "error"),
  };
};

export const buildChampionshipStandingsImportPayload = (
  preview: ChampionshipStandingsPreviewFile,
  file: ChampionshipStandingsFileDescriptor,
): ChampionshipStandingsImportPayload => {
  if (!preview.valid || preview.standings.length === 0) {
    throw new Error("Le classement officiel n’est pas exploitable.");
  }
  return { file, standings: preview.standings };
};
