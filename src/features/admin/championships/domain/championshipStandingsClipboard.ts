import type {
  ChampionshipStandingImportRow,
  ChampionshipStandingsPreviewFile,
} from "./championshipStandingsImport";

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();

const cleanLine = (value: string) => value.replace(/\s+/gu, " ").trim();

const parseNumber = (value: string) => {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};

const parseInteger = (value: string) => {
  const parsed = parseNumber(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
};

const parseTeam = (value: string) => {
  const match = value.match(/^(.*\S)\s+(\d{1,3})$/u);
  if (!match || !/[A-Za-zÀ-ÖØ-öø-ÿ]/u.test(match[1])) return null;
  return {
    clubName: match[1].trim(),
    teamNumber: match[2],
  };
};

const isDivisionLine = (value: string) =>
  /^(?:M\d+\b.*|S[eé]nior\b.*\bS[eé]rie\b.*)$/iu.test(value);

const poolFromLine = (value: string) => {
  const match = value.match(/^Poule\s+(.+)$/iu);
  return match?.[1]?.trim() ?? null;
};

const isStandingsHeaderLine = (value: string) => {
  const normalized = fold(value);
  const markers = [
    "vict",
    "def",
    "perd",
    "points",
    "points partie",
    "points marq",
    "points enc",
    "dif points",
  ];
  return markers.filter((marker) => normalized.includes(marker)).length >= 4;
};

const trailingRankFromHeader = (value: string) => {
  if (!isStandingsHeaderLine(value)) return null;
  const match = value.match(/(?:^|\s)(\d{1,2})\s*$/u);
  if (!match) return null;
  const rank = Number(match[1]);
  return rank > 0 ? rank : null;
};

const rankAndTeamFromLine = (value: string) => {
  if (isStandingsHeaderLine(value)) return null;

  const inline = value.match(/^(\d{1,2})\s+(.+\s+\d{1,3})$/u);
  if (inline && parseTeam(inline[2])) {
    return { rank: Number(inline[1]), teamLabel: inline[2].trim() };
  }
  const teamOnly = value.match(/^(.+\s+\d{1,3})$/u);
  if (teamOnly && parseTeam(teamOnly[1])) {
    return { rank: null, teamLabel: teamOnly[1].trim() };
  }
  return null;
};

const teamWithFollowingNumber = (lines: string[], index: number) => {
  const line = lines[index] ?? "";
  const next = lines[index + 1] ?? "";
  if (
    !line ||
    line.startsWith("-") ||
    isDivisionLine(line) ||
    poolFromLine(line) ||
    isStandingsHeaderLine(line) ||
    !/[A-Za-zÀ-ÖØ-öø-ÿ]/u.test(line) ||
    !/^\d{1,3}$/u.test(next)
  ) {
    return null;
  }
  const teamLabel = `${line} ${next}`;
  return parseTeam(teamLabel) ? teamLabel : null;
};

const numericTokens = (value: string) => {
  if (!/^-?\d+(?:[.,]\d+)?(?:\s+-?\d+(?:[.,]\d+)?)*$/u.test(value)) {
    return [];
  }
  return value
    .split(/\s+/u)
    .map(parseNumber)
    .filter((entry): entry is number => entry !== null);
};

export const parseChampionshipStandingsClipboard = (
  source: string,
  fallbackDivision = "",
): ChampionshipStandingsPreviewFile => {
  const lines = source
    .split(/\r?\n/u)
    .map(cleanLine)
    .filter(Boolean);
  const standings: ChampionshipStandingImportRow[] = [];
  const issues: ChampionshipStandingsPreviewFile["issues"] = [];

  let division = fallbackDivision.trim();
  let poolCode = "";
  let pendingRank: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (isDivisionLine(line)) {
      division = line;
      pendingRank = null;
      continue;
    }

    const nextPool = poolFromLine(line);
    if (nextPool) {
      poolCode = nextPool;
      pendingRank = null;
      continue;
    }

    if (isStandingsHeaderLine(line)) {
      pendingRank = trailingRankFromHeader(line) ?? pendingRank;
      continue;
    }

    if (/^\d{1,2}$/u.test(line)) {
      pendingRank = Number(line);
      continue;
    }

    let teamCandidate = rankAndTeamFromLine(line);
    let consumedTeamNumberLine = false;
    if (!teamCandidate) {
      const splitTeamLabel = teamWithFollowingNumber(lines, index);
      if (splitTeamLabel) {
        teamCandidate = { rank: null, teamLabel: splitTeamLabel };
        consumedTeamNumberLine = true;
      }
    }
    if (!teamCandidate) continue;

    const parsedTeam = parseTeam(teamCandidate.teamLabel);
    const rank = teamCandidate.rank ?? pendingRank;
    pendingRank = null;

    if (!division || !poolCode || !parsedTeam || !rank || rank <= 0) {
      issues.push({
        row: index + 1,
        severity: "error",
        message: `Classement incomplet près de « ${teamCandidate.teamLabel} » : série, poule ou rang introuvable.`,
      });
      if (consumedTeamNumberLine) index += 1;
      continue;
    }

    const stats: number[] = [];
    let cursor = index + (consumedTeamNumberLine ? 2 : 1);
    for (; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor];
      if (
        isDivisionLine(candidate) ||
        poolFromLine(candidate) ||
        isStandingsHeaderLine(candidate) ||
        rankAndTeamFromLine(candidate) ||
        teamWithFollowingNumber(lines, cursor)
      ) {
        break;
      }
      if (candidate.startsWith("-")) continue;
      stats.push(...numericTokens(candidate));
      if (stats.length >= 9) {
        cursor += 1;
        break;
      }
    }

    if (stats.length < 9) {
      issues.push({
        row: index + 1,
        severity: "error",
        message: `Les chiffres officiels de ${teamCandidate.teamLabel} n’ont pas été reconnus.`,
      });
      if (consumedTeamNumberLine) index += 1;
      continue;
    }

    const [
      winsValue,
      lossesValue,
      lostValue,
      pointsValue,
      pointsPerGame,
      scoreForValue,
      scoreAgainstValue,
      differenceValue,
      averageDifference,
    ] = stats;
    const wins = parseInteger(String(winsValue));
    const losses = parseInteger(String(lossesValue));
    const lost = parseInteger(String(lostValue));
    const scoreFor = parseInteger(String(scoreForValue));
    const scoreAgainst = parseInteger(String(scoreAgainstValue));
    const scoreDifference = parseInteger(String(differenceValue));

    standings.push({
      row: index + 1,
      division,
      divisionNormalized: fold(division),
      poolCode,
      teamLabel: teamCandidate.teamLabel,
      clubName: parsedTeam.clubName,
      clubNormalized: fold(parsedTeam.clubName),
      teamNumber: parsedTeam.teamNumber,
      rank,
      played:
        wins !== null && losses !== null
          ? wins + losses + (lost ?? 0)
          : null,
      wins,
      draws: null,
      losses,
      points: pointsValue,
      scoreFor,
      scoreAgainst,
      scoreDifference,
      sourcePayload: {
        "Vic.": String(winsValue),
        "Déf.": String(lossesValue),
        "Perd.": String(lost ?? lostValue),
        Points: String(pointsValue),
        "Points / partie": String(pointsPerGame),
        "points marq.": String(scoreForValue),
        "points enc.": String(scoreAgainstValue),
        "Dif. points": String(differenceValue),
        "Dif. points moy.": String(averageDifference),
      },
    });

    index = Math.max(index, cursor - 1);
  }

  if (standings.length === 0 && issues.length === 0) {
    issues.push({
      row: 0,
      severity: "error",
      message:
        "Aucune ligne de classement n’a été reconnue. Copiez le classement affiché sur la page fédérale avec au moins une poule complète.",
    });
  }

  return {
    standings,
    issues,
    valid: standings.length > 0 && !issues.some((issue) => issue.severity === "error"),
  };
};
