export const ERREBOT_PARSER_VERSION = "errebot-pdf-v1";

export type ErrebotSeriesName =
  "1re Série" | "2me Série" | "3me Série" | "4me Série" | "Féminines";

export type ErrebotPlayer = {
  firstName: string;
  lastName: string;
  phone: string;
};

export type ErrebotTeam = {
  externalId: string;
  series: ErrebotSeriesName;
  players: [ErrebotPlayer, ErrebotPlayer];
};

export type ErrebotPool = {
  series: ErrebotSeriesName;
  name: string;
  teamExternalIds: string[];
};

export type ErrebotFixture = {
  date: string;
  time: string;
  series: ErrebotSeriesName;
  pool: string;
  team1ExternalId: string;
  team2ExternalId: string;
  score1: number | null;
  score2: number | null;
};

export type ErrebotParseIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
};

export type ErrebotSeriesSummary = {
  series: ErrebotSeriesName;
  teamCount: number;
  poolCount: number;
  fixtureCount: number;
};

export type ErrebotTournamentParseResult = {
  parserVersion: string;
  teams: ErrebotTeam[];
  pools: ErrebotPool[];
  fixtures: ErrebotFixture[];
  emptySlotCount: number;
  poolSize3Count: number;
  series: ErrebotSeriesSummary[];
  issues: ErrebotParseIssue[];
};

const SERIES_ORDER: ErrebotSeriesName[] = [
  "1re Série",
  "2me Série",
  "3me Série",
  "4me Série",
  "Féminines",
];

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const normalizeSeries = (value: string): ErrebotSeriesName | null => {
  const normalized = fold(value);
  if (["1re serie", "1ere serie", "1ere serie"].includes(normalized)) {
    return "1re Série";
  }
  if (["2me serie", "2eme serie", "2e serie"].includes(normalized)) {
    return "2me Série";
  }
  if (["3me serie", "3eme serie", "3e serie"].includes(normalized)) {
    return "3me Série";
  }
  if (["4me serie", "4eme serie", "4e serie"].includes(normalized)) {
    return "4me Série";
  }
  if (normalized === "feminines") return "Féminines";
  return null;
};

const cellsFromLine = (line: string) =>
  line
    .replace(/\u00a0/g, " ")
    .split(/\t+/)
    .map((cell) => cell.replace(/\s+/g, " ").trim())
    .filter(Boolean);

const externalIdFromCell = (value: string) => {
  const match = value.match(/^(\d{3})\b/);
  return match?.[1] ?? null;
};

const phoneLooksUsable = (value: string) =>
  value.replace(/\D/g, "").length >= 8;

const parseDateTime = (cells: string[]) => {
  const combined = cells[0]?.match(
    /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2})$/,
  );
  if (combined) {
    return {
      date: `${combined[3]}-${combined[2]}-${combined[1]}`,
      time: combined[4],
      nextIndex: 1,
    };
  }

  const date = cells[0]?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const time = cells[1]?.match(/^\d{2}:\d{2}$/);
  if (!date || !time) return null;
  return {
    date: `${date[3]}-${date[2]}-${date[1]}`,
    time: time[0],
    nextIndex: 2,
  };
};

const pairKey = (left: string, right: string) => [left, right].sort().join("|");

const poolKey = (series: ErrebotSeriesName, pool: string) =>
  `${series}|${pool}`;

export const parseErrebotTournament = (
  sourceText: string,
): ErrebotTournamentParseResult => {
  const lines = sourceText
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const issues: ErrebotParseIssue[] = [];
  const teamMap = new Map<string, ErrebotTeam>();
  const poolMap = new Map<string, ErrebotPool>();

  for (const line of lines) {
    const cells = cellsFromLine(line);
    const externalId = cells[0]?.match(/^\d{3}$/)?.[0];
    const series = normalizeSeries(cells[1] ?? "");
    if (!externalId || !series || cells.length < 8) continue;
    if (!phoneLooksUsable(cells[4]) || !phoneLooksUsable(cells[7])) {
      continue;
    }

    const team: ErrebotTeam = {
      externalId,
      series,
      players: [
        {
          firstName: cells[2],
          lastName: cells[3],
          phone: cells[4],
        },
        {
          firstName: cells[5],
          lastName: cells[6],
          phone: cells[7],
        },
      ],
    };

    const previous = teamMap.get(externalId);
    if (previous) {
      issues.push({
        severity: "error",
        code: "duplicate_team_id",
        message: `L’identifiant d’équipe ${externalId} apparaît plusieurs fois.`,
      });
    } else {
      teamMap.set(externalId, team);
    }
  }

  for (const line of lines) {
    const cells = cellsFromLine(line);
    const series = normalizeSeries(cells[0] ?? "");
    const pool = cells[1] ?? "";
    if (!series || !/^[A-Z]$/.test(pool)) continue;

    const teamExternalIds = cells
      .slice(2)
      .map(externalIdFromCell)
      .filter((value): value is string => value !== null);
    if (teamExternalIds.length < 3 || teamExternalIds.length > 6) {
      continue;
    }

    const key = poolKey(series, pool);
    const previous = poolMap.get(key);
    if (!previous) {
      poolMap.set(key, { series, name: pool, teamExternalIds });
    } else if (
      previous.teamExternalIds.join("|") !== teamExternalIds.join("|")
    ) {
      issues.push({
        severity: "error",
        code: "conflicting_pool",
        message: `La poule ${pool} de ${series} présente deux compositions différentes.`,
      });
    }
  }

  const fixtures: ErrebotFixture[] = [];
  let emptySlotCount = 0;
  for (const line of lines) {
    const cells = cellsFromLine(line);
    const dateTime = parseDateTime(cells);
    if (!dateTime) continue;

    const series = normalizeSeries(cells[dateTime.nextIndex] ?? "");
    const pool = cells[dateTime.nextIndex + 1] ?? "";
    if (!series || !/^[A-Z]$/.test(pool)) {
      emptySlotCount += 1;
      continue;
    }

    const detailCells = cells.slice(dateTime.nextIndex + 2);
    const refs = detailCells
      .map((cell, index) => ({
        index,
        externalId: externalIdFromCell(cell),
      }))
      .filter(
        (ref): ref is { index: number; externalId: string } =>
          ref.externalId !== null && teamMap.has(ref.externalId),
      );

    if (refs.length < 2) {
      emptySlotCount += 1;
      continue;
    }
    if (refs.length > 2) {
      issues.push({
        severity: "error",
        code: "ambiguous_fixture",
        message: `Un créneau de ${series} ${pool} contient plus de deux équipes reconnues.`,
      });
      continue;
    }

    const scoreValues = detailCells
      .slice(refs[0].index + 1, refs[1].index)
      .filter((cell) => /^\d+$/.test(cell))
      .map(Number);

    fixtures.push({
      date: dateTime.date,
      time: dateTime.time,
      series,
      pool,
      team1ExternalId: refs[0].externalId,
      team2ExternalId: refs[1].externalId,
      score1: scoreValues[0] ?? null,
      score2: scoreValues[1] ?? null,
    });
  }

  const teams = [...teamMap.values()].sort(
    (left, right) => Number(left.externalId) - Number(right.externalId),
  );
  const pools = [...poolMap.values()].sort((left, right) => {
    const seriesDelta =
      SERIES_ORDER.indexOf(left.series) - SERIES_ORDER.indexOf(right.series);
    return seriesDelta || left.name.localeCompare(right.name, "fr");
  });

  if (teams.length === 0) {
    issues.push({
      severity: "error",
      code: "no_teams",
      message: "Aucune équipe Errebot n’a été reconnue dans le PDF.",
    });
  }
  if (pools.length === 0) {
    issues.push({
      severity: "error",
      code: "no_pools",
      message: "Aucune poule Errebot n’a été reconnue dans le PDF.",
    });
  }

  const assignmentCounts = new Map<string, number>();
  for (const pool of pools) {
    for (const externalId of pool.teamExternalIds) {
      if (!teamMap.has(externalId)) {
        issues.push({
          severity: "error",
          code: "pool_unknown_team",
          message: `La poule ${pool.name} de ${pool.series} référence l’équipe ${externalId}, absente du registre.`,
        });
      }
      assignmentCounts.set(
        externalId,
        (assignmentCounts.get(externalId) ?? 0) + 1,
      );
    }
  }
  for (const team of teams) {
    const assignmentCount = assignmentCounts.get(team.externalId) ?? 0;
    if (assignmentCount !== 1) {
      issues.push({
        severity: "error",
        code: "team_pool_assignment",
        message:
          assignmentCount === 0
            ? `L’équipe ${team.externalId} n’est affectée à aucune poule.`
            : `L’équipe ${team.externalId} est affectée à plusieurs poules.`,
      });
    }
  }

  const fixturesByPool = new Map<string, ErrebotFixture[]>();
  for (const fixture of fixtures) {
    const key = poolKey(fixture.series, fixture.pool);
    const parsedPool = poolMap.get(key);
    if (!parsedPool) {
      issues.push({
        severity: "error",
        code: "fixture_unknown_pool",
        message: `Un match référence la poule ${fixture.pool} de ${fixture.series}, absente de la répartition.`,
      });
      continue;
    }
    if (
      !parsedPool.teamExternalIds.includes(fixture.team1ExternalId) ||
      !parsedPool.teamExternalIds.includes(fixture.team2ExternalId)
    ) {
      issues.push({
        severity: "error",
        code: "fixture_team_mismatch",
        message: `Un match de la poule ${fixture.pool} de ${fixture.series} contient une équipe hors poule.`,
      });
    }
    fixturesByPool.set(key, [...(fixturesByPool.get(key) ?? []), fixture]);
  }

  for (const parsedPool of pools) {
    const key = poolKey(parsedPool.series, parsedPool.name);
    const expectedPairs = new Set<string>();
    parsedPool.teamExternalIds.forEach((left, index) => {
      parsedPool.teamExternalIds.slice(index + 1).forEach((right) => {
        expectedPairs.add(pairKey(left, right));
      });
    });
    const actualFixtures = fixturesByPool.get(key) ?? [];
    const actualPairs = new Set(
      actualFixtures.map((fixture) =>
        pairKey(fixture.team1ExternalId, fixture.team2ExternalId),
      ),
    );

    if (actualFixtures.length !== actualPairs.size) {
      issues.push({
        severity: "error",
        code: "duplicate_fixture",
        message: `La poule ${parsedPool.name} de ${parsedPool.series} contient un match en doublon.`,
      });
    }
    const missingCount = [...expectedPairs].filter(
      (pair) => !actualPairs.has(pair),
    ).length;
    const extraCount = [...actualPairs].filter(
      (pair) => !expectedPairs.has(pair),
    ).length;
    if (missingCount > 0 || extraCount > 0) {
      issues.push({
        severity: "error",
        code: "fixture_set_mismatch",
        message: `Le calendrier de la poule ${parsedPool.name} de ${parsedPool.series} est incohérent (${missingCount} match(s) manquant(s), ${extraCount} inattendu(s)).`,
      });
    }
  }

  const series = SERIES_ORDER.map((seriesName) => ({
    series: seriesName,
    teamCount: teams.filter((team) => team.series === seriesName).length,
    poolCount: pools.filter((pool) => pool.series === seriesName).length,
    fixtureCount: fixtures.filter((fixture) => fixture.series === seriesName)
      .length,
  })).filter(
    (summary) =>
      summary.teamCount > 0 ||
      summary.poolCount > 0 ||
      summary.fixtureCount > 0,
  );

  return {
    parserVersion: ERREBOT_PARSER_VERSION,
    teams,
    pools,
    fixtures,
    emptySlotCount,
    poolSize3Count: pools.filter((pool) => pool.teamExternalIds.length === 3)
      .length,
    series,
    issues,
  };
};
