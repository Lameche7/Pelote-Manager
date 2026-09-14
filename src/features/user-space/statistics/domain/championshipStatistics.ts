import type { MyChampionship } from "@/features/user-space/championships/services/myChampionshipsService";

export type StatisticsOutcome = "win" | "draw" | "loss";
export type StatisticsTeamSide = "all" | "a" | "b";

export type ChampionshipStatisticsFilters = {
  season: string;
  specialty: string;
  championshipId: string;
  divisionId: string;
  phase: string;
  teamSide: StatisticsTeamSide;
};

export type ChampionshipStatisticsRow = {
  matchId: string;
  championshipId: string;
  championshipName: string;
  specialty: string;
  seasonLabel: string;
  divisionId: string;
  divisionName: string;
  phase: string;
  teamSide: "a" | "b";
  opponentLabel: string;
  date: string | null;
  scoreMine: number;
  scoreOpponent: number;
  outcome: StatisticsOutcome;
};

export type StatisticsBreakdown = {
  label: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
};

export type ChampionshipStatisticsSummary = {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  scoreFor: number;
  scoreAgainst: number;
  scoreDifference: number;
  averageFor: number;
  averageAgainst: number;
  singleSpecialty: boolean;
  currentStreak: { outcome: StatisticsOutcome; length: number } | null;
};

export const emptyChampionshipStatisticsFilters = (): ChampionshipStatisticsFilters => ({
  season: "",
  specialty: "",
  championshipId: "",
  divisionId: "",
  phase: "",
  teamSide: "all",
});

const outcomeFor = (scoreMine: number, scoreOpponent: number): StatisticsOutcome =>
  scoreMine > scoreOpponent ? "win" : scoreMine < scoreOpponent ? "loss" : "draw";

const matchDate = (match: MyChampionship["matches"][number]) =>
  match.agreementOn ?? match.reportOn ?? match.scheduledOn;

export const buildChampionshipStatisticsRows = (
  championships: MyChampionship[],
): ChampionshipStatisticsRow[] => {
  const rows = new Map<string, ChampionshipStatisticsRow>();

  championships.forEach((championship) => {
    championship.matches.forEach((match) => {
      if (match.scoreMine === null || match.scoreOpponent === null) return;
      if (rows.has(match.id)) return;

      rows.set(match.id, {
        matchId: match.id,
        championshipId: championship.championshipId,
        championshipName: championship.championshipName,
        specialty: championship.specialty,
        seasonLabel: championship.seasonLabel,
        divisionId: championship.divisionId,
        divisionName: championship.divisionName,
        phase: match.phase,
        teamSide: match.teamSide,
        opponentLabel: match.opponentLabel,
        date: matchDate(match),
        scoreMine: match.scoreMine,
        scoreOpponent: match.scoreOpponent,
        outcome: outcomeFor(match.scoreMine, match.scoreOpponent),
      });
    });
  });

  return [...rows.values()];
};

export const filterChampionshipStatisticsRows = (
  rows: ChampionshipStatisticsRow[],
  filters: ChampionshipStatisticsFilters,
) =>
  rows.filter((row) => {
    if (filters.season && row.seasonLabel !== filters.season) return false;
    if (filters.specialty && row.specialty !== filters.specialty) return false;
    if (filters.championshipId && row.championshipId !== filters.championshipId)
      return false;
    if (filters.divisionId && row.divisionId !== filters.divisionId) return false;
    if (filters.phase && row.phase !== filters.phase) return false;
    if (filters.teamSide !== "all" && row.teamSide !== filters.teamSide)
      return false;
    return true;
  });

const breakdown = (
  rows: ChampionshipStatisticsRow[],
  labelFor: (row: ChampionshipStatisticsRow) => string,
): StatisticsBreakdown[] => {
  const groups = new Map<string, ChampionshipStatisticsRow[]>();
  rows.forEach((row) => {
    const label = labelFor(row) || "Non renseigné";
    groups.set(label, [...(groups.get(label) ?? []), row]);
  });

  return [...groups.entries()]
    .map(([label, group]) => {
      const wins = group.filter((row) => row.outcome === "win").length;
      const draws = group.filter((row) => row.outcome === "draw").length;
      const losses = group.filter((row) => row.outcome === "loss").length;
      return {
        label,
        played: group.length,
        wins,
        draws,
        losses,
        winRate: group.length ? (wins / group.length) * 100 : 0,
      };
    })
    .sort((left, right) => right.played - left.played || left.label.localeCompare(right.label, "fr"));
};

const currentStreak = (rows: ChampionshipStatisticsRow[]) => {
  const ordered = [...rows]
    .filter((row) => row.date)
    .sort((left, right) => String(right.date).localeCompare(String(left.date)));
  const first = ordered[0];
  if (!first) return null;
  let length = 0;
  for (const row of ordered) {
    if (row.outcome !== first.outcome) break;
    length += 1;
  }
  return { outcome: first.outcome, length };
};

export const summarizeChampionshipStatistics = (
  rows: ChampionshipStatisticsRow[],
): ChampionshipStatisticsSummary => {
  const wins = rows.filter((row) => row.outcome === "win").length;
  const draws = rows.filter((row) => row.outcome === "draw").length;
  const losses = rows.filter((row) => row.outcome === "loss").length;
  const scoreFor = rows.reduce((sum, row) => sum + row.scoreMine, 0);
  const scoreAgainst = rows.reduce((sum, row) => sum + row.scoreOpponent, 0);
  const specialties = new Set(rows.map((row) => row.specialty).filter(Boolean));

  return {
    played: rows.length,
    wins,
    draws,
    losses,
    winRate: rows.length ? (wins / rows.length) * 100 : 0,
    scoreFor,
    scoreAgainst,
    scoreDifference: scoreFor - scoreAgainst,
    averageFor: rows.length ? scoreFor / rows.length : 0,
    averageAgainst: rows.length ? scoreAgainst / rows.length : 0,
    singleSpecialty: specialties.size <= 1,
    currentStreak: currentStreak(rows),
  };
};

const unique = (values: string[]) =>
  [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));

export const buildChampionshipStatisticsDashboard = (
  championships: MyChampionship[],
  filters: ChampionshipStatisticsFilters,
) => {
  const allRows = buildChampionshipStatisticsRows(championships);
  const rows = filterChampionshipStatisticsRows(allRows, filters);
  const recent = [...rows]
    .sort((left, right) => String(right.date ?? "").localeCompare(String(left.date ?? "")))
    .slice(0, 12);

  return {
    rows,
    summary: summarizeChampionshipStatistics(rows),
    options: {
      seasons: unique(allRows.map((row) => row.seasonLabel)).reverse(),
      specialties: unique(allRows.map((row) => row.specialty)),
      championships: [...new Map(allRows.map((row) => [row.championshipId, row.championshipName])).entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label, "fr")),
      divisions: [...new Map(allRows.map((row) => [row.divisionId, row.divisionName])).entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label, "fr")),
      phases: unique(allRows.map((row) => row.phase)),
    },
    bySeason: breakdown(rows, (row) => row.seasonLabel),
    bySpecialty: breakdown(rows, (row) => row.specialty),
    byPhase: breakdown(rows, (row) => row.phase),
    byChampionship: breakdown(rows, (row) => row.championshipName),
    recent,
  };
};
