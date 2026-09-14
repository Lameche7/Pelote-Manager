import type { MyChampionship } from "@/features/user-space/championships/services/myChampionshipsService";
import type { MyTournamentStatisticsMatch } from "@/features/user-space/statistics/services/myTournamentStatisticsService";

export type StatisticsOutcome = "win" | "loss";
export type StatisticsTeamSide = "all" | "a" | "b";
export type StatisticsSource = "all" | "championship" | "tournament";

export type ChampionshipStatisticsFilters = {
  source: StatisticsSource;
  season: string;
  specialty: string;
  competitionId: string;
  divisionId: string;
  phase: string;
  teamSide: StatisticsTeamSide;
};

export type ChampionshipStatisticsRow = {
  matchId: string;
  source: Exclude<StatisticsSource, "all">;
  competitionId: string;
  competitionName: string;
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
  scoreMetricKey: string;
};

export type StatisticsBreakdown = {
  label: string;
  played: number;
  wins: number;
  losses: number;
  winRate: number;
};

export type ChampionshipStatisticsSummary = {
  played: number;
  wins: number;
  losses: number;
  winRate: number;
  lossRate: number;
  scoreFor: number;
  scoreAgainst: number;
  scoreDifference: number;
  averageFor: number;
  averageAgainst: number;
  scoreMetricsComparable: boolean;
  currentStreak: { outcome: StatisticsOutcome; length: number } | null;
};

export const emptyChampionshipStatisticsFilters = (): ChampionshipStatisticsFilters => ({
  source: "all",
  season: "",
  specialty: "",
  competitionId: "",
  divisionId: "",
  phase: "",
  teamSide: "all",
});

const matchDate = (match: MyChampionship["matches"][number]) =>
  match.agreementOn ?? match.reportOn ?? match.scheduledOn;

export const buildChampionshipStatisticsRows = (
  championships: MyChampionship[],
): ChampionshipStatisticsRow[] => {
  const rows = new Map<string, ChampionshipStatisticsRow>();

  championships.forEach((championship) => {
    championship.matches.forEach((match) => {
      if (match.scoreMine === null || match.scoreOpponent === null) return;
      if (match.scoreMine === match.scoreOpponent) return;
      const key = `championship:${match.id}`;
      if (rows.has(key)) return;

      rows.set(key, {
        matchId: key,
        source: "championship",
        competitionId: championship.championshipId,
        competitionName: championship.championshipName,
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
        outcome: match.scoreMine > match.scoreOpponent ? "win" : "loss",
        scoreMetricKey: `championship:${championship.specialty}`,
      });
    });
  });

  return [...rows.values()];
};

export const buildTournamentStatisticsRows = (
  tournaments: MyTournamentStatisticsMatch[],
): ChampionshipStatisticsRow[] =>
  tournaments.map((match) => ({
    matchId: `tournament:${match.matchId}`,
    source: "tournament",
    competitionId: match.tournamentId,
    competitionName: match.tournamentName,
    specialty: match.specialty,
    seasonLabel: match.seasonLabel,
    divisionId: match.seriesId,
    divisionName: match.seriesName,
    phase: match.phase,
    teamSide: match.teamSide,
    opponentLabel: match.opponentLabel,
    date: match.playDate,
    scoreMine: match.scoreMine,
    scoreOpponent: match.scoreOpponent,
    outcome: match.won ? "win" : "loss",
    scoreMetricKey: [
      "tournament",
      match.specialty,
      match.matchFormat,
      match.singleGamePoints,
      match.mainSetPoints,
      match.decidingSetPoints,
    ].join(":"),
  }));

export const filterChampionshipStatisticsRows = (
  rows: ChampionshipStatisticsRow[],
  filters: ChampionshipStatisticsFilters,
) =>
  rows.filter((row) => {
    if (filters.source !== "all" && row.source !== filters.source) return false;
    if (filters.season && row.seasonLabel !== filters.season) return false;
    if (filters.specialty && row.specialty !== filters.specialty) return false;
    if (filters.competitionId && row.competitionId !== filters.competitionId)
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
      const losses = group.length - wins;
      return {
        label,
        played: group.length,
        wins,
        losses,
        winRate: group.length ? (wins / group.length) * 100 : 0,
      };
    })
    .sort(
      (left, right) =>
        right.played - left.played || left.label.localeCompare(right.label, "fr"),
    );
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
  const losses = rows.length - wins;
  const scoreFor = rows.reduce((sum, row) => sum + row.scoreMine, 0);
  const scoreAgainst = rows.reduce((sum, row) => sum + row.scoreOpponent, 0);
  const metricKeys = new Set(rows.map((row) => row.scoreMetricKey));

  return {
    played: rows.length,
    wins,
    losses,
    winRate: rows.length ? (wins / rows.length) * 100 : 0,
    lossRate: rows.length ? (losses / rows.length) * 100 : 0,
    scoreFor,
    scoreAgainst,
    scoreDifference: scoreFor - scoreAgainst,
    averageFor: rows.length ? scoreFor / rows.length : 0,
    averageAgainst: rows.length ? scoreAgainst / rows.length : 0,
    scoreMetricsComparable: metricKeys.size <= 1,
    currentStreak: currentStreak(rows),
  };
};

const unique = (values: string[]) =>
  [...new Set(values.filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "fr", { numeric: true }),
  );

export const buildChampionshipStatisticsDashboard = (
  championships: MyChampionship[],
  tournaments: MyTournamentStatisticsMatch[],
  filters: ChampionshipStatisticsFilters,
) => {
  const allRows = [
    ...buildChampionshipStatisticsRows(championships),
    ...buildTournamentStatisticsRows(tournaments),
  ];
  const rows = filterChampionshipStatisticsRows(allRows, filters);
  const recent = rows
    .filter((row) => row.date)
    .sort((left, right) => String(right.date).localeCompare(String(left.date)))
    .slice(0, 12);

  return {
    rows,
    summary: summarizeChampionshipStatistics(rows),
    options: {
      seasons: unique(allRows.map((row) => row.seasonLabel)).reverse(),
      specialties: unique(allRows.map((row) => row.specialty)),
      competitions: [
        ...new Map(
          allRows.map((row) => [
            `${row.source}:${row.competitionId}`,
            {
              value: row.competitionId,
              source: row.source,
              label: row.competitionName,
            },
          ]),
        ).values(),
      ].sort((a, b) => a.label.localeCompare(b.label, "fr")),
      divisions: [
        ...new Map(
          allRows.map((row) => [
            `${row.source}:${row.divisionId}`,
            { value: row.divisionId, label: row.divisionName },
          ]),
        ).values(),
      ].sort((a, b) => a.label.localeCompare(b.label, "fr")),
      phases: unique(allRows.map((row) => row.phase)),
    },
    bySeason: breakdown(rows, (row) => row.seasonLabel),
    bySpecialty: breakdown(rows, (row) => row.specialty),
    byPhase: breakdown(rows, (row) => row.phase),
    byCompetition: breakdown(rows, (row) => row.competitionName),
    bySource: breakdown(rows, (row) =>
      row.source === "championship" ? "Championnats" : "Tournois",
    ),
    recent,
  };
};
